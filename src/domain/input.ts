/** Small parsers for what staff type (Slice 3, T22). */

/**
 * A line quantity: a whole number from 1 to 99, or null. The bill builder keeps
 * the raw text while typing and only uses this result, so clearing the field
 * and typing 2 is 2, not 12 (QA Q11).
 */
export function parseQuantity(s: string): number | null {
  const t = s.trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 99 ? n : null;
}
