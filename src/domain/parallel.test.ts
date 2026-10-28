import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import type { Paise } from './money';
import { compareWithLegacy } from './parallel';

const P = (n: number) => n as Paise;

describe('old system vs Chairside (T21, Q10)', () => {
  it('says nothing until the old figures are entered', () => {
    expect(compareWithLegacy({ legacyBillCount: null, legacyCollectedPaise: null, billCount: 3, collectedPaise: P(100) })).toBeNull();
  });

  it('matches', () => {
    const c = compareWithLegacy({ legacyBillCount: 12, legacyCollectedPaise: P(1_500_000), billCount: 12, collectedPaise: P(1_500_000) })!;
    expect(c).toMatchObject({ verdict: 'Matches', matches: true, bills: { diff: 0 }, collected: { diff: 0 } });
  });

  it('QA’s case: old ₹15,000 / 12 bills, Chairside ₹14,384 / 11 bills', () => {
    const c = compareWithLegacy({ legacyBillCount: 12, legacyCollectedPaise: P(1_500_000), billCount: 11, collectedPaise: P(1_438_400) })!;
    expect(c.bills).toEqual({ old: 12, chairside: 11, diff: -1 });
    expect(c.collected).toEqual({ old: 1_500_000, chairside: 1_438_400, diff: -61_600 });
    expect(c.verdict).toBe('Chairside is ₹616 short: 1 bill may be missing');
    expect(c.matches).toBe(false);
  });

  it('more bills in Chairside is not "all entered"', () => {
    expect(compareWithLegacy({ legacyBillCount: 10, legacyCollectedPaise: null, billCount: 12, collectedPaise: P(0) })!.verdict).toBe('Chairside has 2 more bills than the old system');
    expect(compareWithLegacy({ legacyBillCount: 10, legacyCollectedPaise: null, billCount: 11, collectedPaise: P(0) })!.verdict).toBe('Chairside has 1 more bill than the old system');
  });

  it('money short with counts equal, missing bills with money equal, and money over', () => {
    expect(compareWithLegacy({ legacyBillCount: 5, legacyCollectedPaise: P(50_050), billCount: 5, collectedPaise: P(50_000) })!.verdict).toBe('Chairside is ₹0.50 short');
    expect(compareWithLegacy({ legacyBillCount: 6, legacyCollectedPaise: P(50_000), billCount: 4, collectedPaise: P(50_000) })!.verdict).toBe('2 bills may be missing from Chairside');
    expect(compareWithLegacy({ legacyBillCount: null, legacyCollectedPaise: P(10_000), billCount: 0, collectedPaise: P(30_000) })!.verdict).toBe('Chairside has ₹200 more collected than the old system');
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2026-10-21', -6)).toBe('2026-10-15');
  });

  it('half-entered figures never read as a match (QA 28 Oct)', () => {
    const moneyOnly = compareWithLegacy({ legacyBillCount: null, legacyCollectedPaise: P(1_000), billCount: 1, collectedPaise: P(1_000) })!;
    expect(moneyOnly.verdict).toBe('Collected matches; enter the old system\u2019s bill count too');
    expect(moneyOnly.matches).toBe(false);
    const countOnly = compareWithLegacy({ legacyBillCount: 1, legacyCollectedPaise: null, billCount: 1, collectedPaise: P(1_000) })!;
    expect(countOnly.verdict).toBe('Bill count matches; enter the old system\u2019s collected amount too');
    expect(countOnly.matches).toBe(false);
    expect(compareWithLegacy({ legacyBillCount: 1, legacyCollectedPaise: P(1_000), billCount: 1, collectedPaise: P(1_000) })!.matches).toBe(true);
  });
});
