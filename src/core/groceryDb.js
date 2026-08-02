/**
 * The grocery database: seed entries merged with user-added custom entries
 * (spec §10), plus all lookup/matching logic (spec §4.2).
 *
 * This module owns *how* text resolves to an entry. The UI never inspects
 * `matchTerms` itself, so a real stemmer or a fuzzy-search library can be
 * dropped in here without touching a component.
 */

import { SEED_ENTRIES } from '../data/groceryData.js';
import { normalize, singularize, expandTerms, slugify } from './text.js';
import { categoryDefaultUnit, OTHER_CATEGORY, getCategory } from './categories.js';
import { DEFAULT_UNIT, isUnit } from './units.js';

/** Custom entries win on id collision so a user rename can shadow a seed row. */
export function buildDatabase(customEntries = []) {
  const byId = new Map();
  for (const entry of SEED_ENTRIES) byId.set(entry.id, entry);
  for (const entry of customEntries) byId.set(entry.id, entry);

  const entries = [...byId.values()];
  const byTerm = new Map();
  for (const entry of entries) {
    for (const term of entry.matchTerms ?? []) {
      if (!byTerm.has(term)) byTerm.set(term, entry);
    }
  }

  return { entries, byId, byTerm };
}

export function getEntry(db, id) {
  if (!id) return null;
  return db.byId.get(id) ?? null;
}

/**
 * Exact resolution: normalize the input, then try it and its singular form
 * against every entry's match terms. Returns null when nothing matches.
 */
export function matchEntry(db, input) {
  const value = normalize(input);
  if (!value) return null;
  return db.byTerm.get(value) ?? db.byTerm.get(singularize(value)) ?? null;
}

/**
 * Autocomplete ranking (spec §4.3): starts-with beats contains; within a tier,
 * shorter names first, then alphabetical. Matching is done against the
 * canonical name *and* the match terms, so "scallion" surfaces "Green Onion".
 */
export function searchEntries(db, query, limit = 8) {
  const value = normalize(query);
  if (!value) return [];
  const singular = singularize(value);

  const scored = [];
  for (const entry of db.entries) {
    const score = scoreEntry(entry, value, singular);
    if (score !== null) scored.push({ entry, score });
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    if (a.entry.name.length !== b.entry.name.length) {
      return a.entry.name.length - b.entry.name.length;
    }
    return a.entry.name.localeCompare(b.entry.name);
  });

  return scored.slice(0, limit).map((row) => row.entry);
}

// 0 = exact, 1 = name starts-with, 2 = term starts-with, 3 = contains.
function scoreEntry(entry, value, singular) {
  const name = normalize(entry.name);
  const terms = entry.matchTerms ?? [];

  if (name === value || name === singular || terms.includes(value) || terms.includes(singular)) {
    return 0;
  }
  if (name.startsWith(value)) return 1;
  if (terms.some((term) => term.startsWith(value))) return 2;
  if (name.includes(value) || terms.some((term) => term.includes(value))) return 3;
  return null;
}

/** The unit a freshly added item should default to (spec §4.3). */
export function defaultUnitFor(entry) {
  if (!entry) return DEFAULT_UNIT;
  if (isUnit(entry.defaultUnit)) return entry.defaultUnit;
  return categoryDefaultUnit(entry.category);
}

/**
 * Build a new custom `GroceryDBEntry` from freeform text (spec §4.3).
 * The caller persists it; this only shapes the record.
 */
export function createCustomEntry(name, category = OTHER_CATEGORY, emoji = null) {
  const displayName = String(name).trim().replace(/\s+/g, ' ');
  const resolved = getCategory(category);
  return {
    id: `custom:${slugify(displayName)}:${Date.now().toString(36)}`,
    name: titleCase(displayName),
    matchTerms: expandTerms(displayName),
    category: resolved.id,
    emoji: emoji || null,
    defaultUnit: resolved.defaultUnit,
    isCustom: true,
  };
}

function titleCase(value) {
  return value.replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

/**
 * Category to show for a list item.
 *
 * Precedence matters: this device's database entry wins, because it reflects
 * any renaming or recategorizing done here. Failing that we trust the snapshot
 * carried on the item itself — which is what makes an item referencing another
 * person's custom entry land in the right aisle instead of "Other". Only then
 * do we fall back to matching by name.
 */
export function categoryOf(db, item) {
  const entry = getEntry(db, item.dbEntryId);
  if (entry) return entry.category;
  if (item.category) return item.category;
  const matched = matchEntry(db, item.name);
  return matched ? matched.category : OTHER_CATEGORY;
}

/** Emoji to show for a list item, or null for the placeholder icon. */
export function emojiOf(db, item) {
  const entry = getEntry(db, item.dbEntryId);
  if (entry) return entry.emoji;
  // A `category` on the item means it carries a snapshot, so a null emoji
  // there is a real "this item has no emoji" rather than missing data.
  if (item.category) return item.emoji ?? null;
  const matched = matchEntry(db, item.name);
  return matched ? matched.emoji : null;
}
