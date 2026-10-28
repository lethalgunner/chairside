/**
 * Old system vs Chairside, the measure the parallel run exists for (Slice 3,
 * T21, QA Q10). Pure: differences are derived from the day book's stored
 * legacy figures and Chairside's own totals, never stored.
 */
import { formatINR, type Paise } from './money';

export interface LegacyComparison {
  bills: { old: number | null; chairside: number; diff: number | null };
  collected: { old: Paise | null; chairside: Paise; diff: Paise | null };
  /** Plain-language summary, e.g. "Chairside is ₹616 short: 1 bill may be missing". */
  verdict: string;
  matches: boolean;
}

/** Rupees as staff read them: no ".00" on whole amounts. */
export function rupeesPlain(p: Paise): string {
  return formatINR(Math.abs(p) as Paise, { paise: Math.abs(p) % 100 !== 0 });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Null when nothing from the old system was entered yet. */
export function compareWithLegacy(p: {
  legacyBillCount: number | null;
  legacyCollectedPaise: Paise | null;
  billCount: number;
  collectedPaise: Paise;
}): LegacyComparison | null {
  if (p.legacyBillCount === null && p.legacyCollectedPaise === null) return null;
  const billDiff = p.legacyBillCount === null ? null : p.billCount - p.legacyBillCount;
  const moneyDiff = p.legacyCollectedPaise === null ? null : ((p.collectedPaise - p.legacyCollectedPaise) as Paise);

  const parts: string[] = [];
  const missing = billDiff !== null && billDiff < 0 ? -billDiff : 0;
  const extra = billDiff !== null && billDiff > 0 ? billDiff : 0;
  if (moneyDiff !== null && moneyDiff < 0) {
    parts.push(`Chairside is ${rupeesPlain(moneyDiff)} short${missing ? `: ${plural(missing, 'bill', 'bills')} may be missing` : ''}`);
  } else if (missing) {
    parts.push(`${plural(missing, 'bill', 'bills')} may be missing from Chairside`);
  }
  if (moneyDiff !== null && moneyDiff > 0) parts.push(`Chairside has ${rupeesPlain(moneyDiff)} more collected than the old system`);
  if (extra) parts.push(`Chairside has ${plural(extra, 'more bill', 'more bills')} than the old system`);

  // Half-entered figures are not a match (QA 28 Oct: money alone said "Matches" with no bill count).
  const gap = p.legacyBillCount === null ? 'enter the old system\u2019s bill count too' : p.legacyCollectedPaise === null ? 'enter the old system\u2019s collected amount too' : null;
  const verdict = parts.length ? parts.join('. ') : gap ? `${p.legacyBillCount === null ? 'Collected' : 'Bill count'} matches; ${gap}` : 'Matches';
  return {
    bills: { old: p.legacyBillCount, chairside: p.billCount, diff: billDiff },
    collected: { old: p.legacyCollectedPaise, chairside: p.collectedPaise, diff: moneyDiff },
    verdict,
    matches: parts.length === 0 && gap === null,
  };
}
