/** Units of measure (spec §4.5). */

export const UNITS = [
  { id: 'count', label: 'count', short: '' },
  { id: 'cup', label: 'cup', short: 'cup' },
  { id: 'tbsp', label: 'tbsp', short: 'tbsp' },
  { id: 'tsp', label: 'tsp', short: 'tsp' },
  { id: 'oz', label: 'oz', short: 'oz' },
  { id: 'fl oz', label: 'fl oz', short: 'fl oz' },
  { id: 'lb', label: 'lb', short: 'lb' },
  { id: 'g', label: 'g', short: 'g' },
  { id: 'kg', label: 'kg', short: 'kg' },
  { id: 'pkg', label: 'pkg', short: 'pkg' },
  { id: 'other', label: 'other…', short: '' },
];

export const UNIT_IDS = UNITS.map((u) => u.id);
export const DEFAULT_UNIT = 'count';

export function isUnit(value) {
  return UNIT_IDS.includes(value);
}

/**
 * How a quantity + unit reads on a row: "3" for counts, "2 lb", "1 bunch"
 * when the user chose "other" and typed a label.
 */
export function formatQuantity(quantity, unit, unitLabel) {
  const amount = formatNumber(quantity);
  if (unit === 'other') {
    const label = (unitLabel || '').trim();
    return label ? `${amount} ${label}` : amount;
  }
  const short = UNITS.find((u) => u.id === unit)?.short ?? '';
  return short ? `${amount} ${short}` : amount;
}

/** Trims float noise from summed quantities (0.30000000000000004 -> 0.3). */
export function formatNumber(value) {
  const n = Number(value) || 0;
  return String(Math.round(n * 100) / 100);
}
