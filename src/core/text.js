/**
 * Text normalization + naive English pluralization.
 *
 * Deliberately isolated (spec §10): swapping in a real stemmer later means
 * rewriting this file only. Nothing here touches storage or the DOM.
 */

/** Irregular plurals that the rules below get wrong. Covers the seed data. */
const IRREGULAR = {
  loaf: 'loaves',
  leaf: 'leaves',
  knife: 'knives',
  half: 'halves',
  shelf: 'shelves',
  potato: 'potatoes',
  tomato: 'tomatoes',
  mango: 'mangoes',
  avocado: 'avocados',
  echo: 'echoes',
  goose: 'geese',
  foot: 'feet',
  tooth: 'teeth',
  child: 'children',
  person: 'people',
  mouse: 'mice',
};

/** Words that are their own plural — never strip a trailing "s". */
const UNCOUNTABLE = new Set([
  'rice', 'molasses', 'hummus', 'couscous', 'asparagus', 'swiss', 'grits',
  'oats', 'peas', 'greens', 'chips', 'crackers', 'pretzels', 'noodles',
  'cheese', 'juice', 'lettuce', 'sauce', 'produce', 'spice', 'sausage',
  'water', 'milk', 'bread', 'flour', 'sugar', 'salt', 'pepper', 'butter',
  'garlic', 'spinach', 'broccoli', 'corn', 'coffee', 'tea', 'beer', 'wine',
  'honey', 'syrup', 'oil', 'vinegar', 'salsa', 'ketchup', 'mustard',
  'mayonnaise', 'yogurt', 'cereal', 'granola', 'popcorn', 'pasta',
]);

const SINGULAR_OF = Object.fromEntries(
  Object.entries(IRREGULAR).map(([one, many]) => [many, one]),
);

/** Lowercase, collapse whitespace, drop punctuation that users type casually. */
export function normalize(input) {
  return String(input ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents: "jalapeño" -> "jalapeno"
    .replace(/[^a-z0-9%\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Best-effort singular form. Operates on the last word only, so
 * "green onions" -> "green onion".
 */
export function singularize(word) {
  const value = normalize(word);
  if (!value) return '';
  const parts = value.split(' ');
  const last = parts[parts.length - 1];

  parts[parts.length - 1] = singularizeWord(last);
  return parts.join(' ');
}

function singularizeWord(word) {
  if (UNCOUNTABLE.has(word)) return word;
  if (SINGULAR_OF[word]) return SINGULAR_OF[word];
  if (word.length <= 3 || !word.endsWith('s')) return word;
  if (word.endsWith('ss') || word.endsWith('us') || word.endsWith('is')) return word;

  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (/(?:ch|sh|s|x|z)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('oes')) return word.slice(0, -2);
  return word.slice(0, -1);
}

/** Best-effort plural form, again on the last word only. */
export function pluralize(word) {
  const value = normalize(word);
  if (!value) return '';
  const parts = value.split(' ');
  const last = parts[parts.length - 1];

  parts[parts.length - 1] = pluralizeWord(last);
  return parts.join(' ');
}

function pluralizeWord(word) {
  if (UNCOUNTABLE.has(word)) return word;
  if (IRREGULAR[word]) return IRREGULAR[word];
  if (word.endsWith('s') && !word.endsWith('ss')) return word;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(?:ch|sh|s|x|z)$/.test(word)) return `${word}es`;
  return `${word}s`;
}

/**
 * Every form a term should be findable under: the term itself plus its
 * singular and plural. Used to build `matchTerms` for database entries.
 */
export function expandTerms(...terms) {
  const out = new Set();
  for (const term of terms) {
    const base = normalize(term);
    if (!base) continue;
    out.add(base);
    out.add(singularize(base));
    out.add(pluralize(singularize(base)));
  }
  return [...out];
}

/** URL/id-safe slug, e.g. "Green Onion" -> "green-onion". */
export function slugify(value) {
  return normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
