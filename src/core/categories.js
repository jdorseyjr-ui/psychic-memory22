/**
 * Categories double as aisle sections in shopping mode (spec §6) and as the
 * colour-coding source in edit mode (spec §7). Order below is the walk order
 * through a generic store — perimeter first, then centre aisles.
 */

export const CATEGORIES = [
  { id: 'produce', label: 'Produce', color: '#4E7C4A', defaultUnit: 'count' },
  { id: 'bakery', label: 'Bakery', color: '#B18A4E', defaultUnit: 'count' },
  { id: 'meat', label: 'Meat', color: '#9C5B4C', defaultUnit: 'lb' },
  { id: 'seafood', label: 'Seafood', color: '#4F8C8C', defaultUnit: 'lb' },
  { id: 'dairy', label: 'Dairy & Eggs', color: '#5E8CA8', defaultUnit: 'count' },
  { id: 'breakfast', label: 'Breakfast', color: '#C97B3C', defaultUnit: 'pkg' },
  { id: 'frozen', label: 'Frozen', color: '#6E93BE', defaultUnit: 'pkg' },
  { id: 'pantry', label: 'Pantry', color: '#AE9138', defaultUnit: 'count' },
  { id: 'snacks', label: 'Snacks', color: '#B5657F', defaultUnit: 'pkg' },
  { id: 'beverages', label: 'Beverages', color: '#6F6BA8', defaultUnit: 'count' },
  { id: 'household', label: 'Household', color: '#6E7A76', defaultUnit: 'count' },
  { id: 'other', label: 'Other', color: '#8A8580', defaultUnit: 'count' },
];

export const OTHER_CATEGORY = 'other';

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id) {
  return BY_ID.get(id) ?? BY_ID.get(OTHER_CATEGORY);
}

export function categoryLabel(id) {
  return getCategory(id).label;
}

export function categoryColor(id) {
  return getCategory(id).color;
}

export function categoryDefaultUnit(id) {
  return getCategory(id).defaultUnit;
}

/** Sort key for shopping-mode sections; unknown categories fall to the end. */
export function aisleIndex(id) {
  const index = CATEGORIES.findIndex((c) => c.id === id);
  return index === -1 ? CATEGORIES.length : index;
}
