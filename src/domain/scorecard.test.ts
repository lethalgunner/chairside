import { describe, expect, it } from 'vitest';
import type { Paise } from './money';
import { billShare, clampFormMs, matchedDays, median, parseWindow, pctDown, required, scoreScope, secondsDown, type ScoreDay } from './scorecard';

const day = (date: string, p: Partial<ScoreDay> = {}): ScoreDay => ({
  date,
  billCount: 0,
  collectedPaise: 0 as Paise,
  legacyBillCount: null,
  legacyCollectedPaise: null,
  closed: false,
  ...p,
});
const none = new Set<string>();
const byKey = (rs: ReturnType<typeof scoreScope>, k: string) => rs.find((r) => r.key === k)!;

describe('criterion 1: old-system bills also in Chairside', () => {
  it('sums min(Chairside, old) over days with an old count, divided by old bills', () => {
    // Day A: 10 old, 8 Chairside → 8. Day B: 5 old, 7 Chairside → 5 (extra bills do not hide missing ones).
    // Day C: no old count → ignored even though it has 4 bills. 13 of 15 = 86.66 % → "86.6%".
    const days = [
      day('2026-10-26', { billCount: 8, legacyBillCount: 10 }),
      day('2026-10-27', { billCount: 7, legacyBillCount: 5 }),
      day('2026-10-28', { billCount: 4 }),
    ];
    expect(billShare(days)).toEqual({ covered: 13, old: 15 });
    const c = byKey(scoreScope({ days, registrationMs: [], ownerViewDates: none }), 'billShare');
    expect(c).toMatchObject({ measured: '86.6% (13 of 15 old-system bills)', threshold: '80% or more', label: 'Pass' });
  });

  it('passes at exactly 80 % and not at 79.x %', () => {
    const at = scoreScope({ days: [day('2026-10-28', { billCount: 4, legacyBillCount: 5 })], registrationMs: [], ownerViewDates: none });
    expect(byKey(at, 'billShare')).toMatchObject({ measured: '80.0% (4 of 5 old-system bills)', label: 'Pass' });
    // 79 of 99 = 79.79 % → shown rounded down so it never reads as 80 %.
    const under = scoreScope({ days: [day('2026-10-28', { billCount: 79, legacyBillCount: 99 })], registrationMs: [], ownerViewDates: none });
    expect(byKey(under, 'billShare')).toMatchObject({ measured: '79.7% (79 of 99 old-system bills)', label: 'Not yet' });
  });

  it('is No data when no old count was entered, or every old count is 0', () => {
    expect(billShare([day('2026-10-28', { billCount: 3 })])).toBeNull();
    expect(billShare([day('2026-10-28', { legacyBillCount: 0 })])).toBeNull();
    expect(byKey(scoreScope({ days: [], registrationMs: [], ownerViewDates: none }), 'billShare').label).toBe('No data');
  });
});

describe('criterion 2: day totals match', () => {
  const ok = (d: string) => day(d, { billCount: 2, collectedPaise: 100_00 as Paise, legacyBillCount: 2, legacyCollectedPaise: 100_00 as Paise });
  it('counts a day only when compareWithLegacy says it matches', () => {
    const days = [
      ok('2026-10-24'),
      day('2026-10-25', { billCount: 2, collectedPaise: 100_00 as Paise, legacyBillCount: 2 }), // half-entered → not matched
      day('2026-10-26', { billCount: 1, collectedPaise: 100_00 as Paise, legacyBillCount: 2, legacyCollectedPaise: 100_00 as Paise }),
      day('2026-10-27'), // activity but nothing typed in
      ok('2026-10-28'),
    ];
    expect(matchedDays(days)).toEqual({ matched: 2, days: 5 });
  });

  it('passes on 4 of 5, not on 3 of 5', () => {
    const four = [ok('2026-10-24'), ok('2026-10-25'), ok('2026-10-26'), ok('2026-10-27'), day('2026-10-28')];
    expect(byKey(scoreScope({ days: four, registrationMs: [], ownerViewDates: none }), 'dayTotals')).toMatchObject({
      measured: '4 of 5 days matched',
      threshold: '4 of 5 days with activity (4 of every 5)',
      label: 'Pass',
    });
    const three = [ok('2026-10-24'), ok('2026-10-25'), ok('2026-10-26'), day('2026-10-27'), day('2026-10-28')];
    expect(byKey(scoreScope({ days: three, registrationMs: [], ownerViewDates: none }), 'dayTotals')).toMatchObject({ measured: '3 of 5 days matched', label: 'Not yet' });
  });

  it('scales the 4-of-5 rule up: 3 active days need all 3; a total over 10 branch-days needs 8', () => {
    expect(required(3, { of: 5, need: 4 })).toBe(3); // 2.4 → 3
    expect(required(10, { of: 5, need: 4 })).toBe(8);
    expect(required(5, { of: 5, need: 3 })).toBe(3);
    expect(required(4, { of: 5, need: 3 })).toBe(3); // 2.4 → 3
    const total = scoreScope({ days: [ok('2026-10-28'), ok('2026-10-28')], registrationMs: [], ownerViewDates: none, unit: 'branch-days' });
    expect(byKey(total, 'dayTotals')).toMatchObject({ measured: '2 of 2 branch-days matched', label: 'Pass' });
  });

  it('is No data with no days of activity', () => {
    expect(byKey(scoreScope({ days: [], registrationMs: [], ownerViewDates: none }), 'dayTotals')).toMatchObject({ measured: 'No days with activity', label: 'No data' });
  });
});

describe('criterion 3: registration median', () => {
  it('takes the middle value, or the mean of the two middle values', () => {
    expect(median([30_000, 10_000, 20_000])).toBe(20_000);
    expect(median([10_000, 40_000, 20_000, 30_000])).toBe(25_000);
    expect(median([])).toBeNull();
  });

  it('passes under 40 s and not at exactly 40 s', () => {
    const under = scoreScope({ days: [], registrationMs: [39_999, 10_000, 90_000], ownerViewDates: none });
    expect(byKey(under, 'registration')).toMatchObject({ measured: '39.9 s (3 registrations)', threshold: 'under 40 s', label: 'Pass' });
    const at = scoreScope({ days: [], registrationMs: [40_000], ownerViewDates: none });
    expect(byKey(at, 'registration')).toMatchObject({ measured: '40.0 s (1 registration)', label: 'Not yet' });
    expect(byKey(scoreScope({ days: [], registrationMs: [], ownerViewDates: none }), 'registration').label).toBe('No data');
  });

  it('clamps browser durations to 0–30 minutes and ignores anything that is not a number', () => {
    expect(clampFormMs(12_345.6)).toBe(12_346);
    expect(clampFormMs(-5)).toBe(0);
    expect(clampFormMs(99 * 60_000)).toBe(30 * 60_000);
    for (const bad of [undefined, null, '12000', Number.NaN, Number.POSITIVE_INFINITY, {}]) expect(clampFormMs(bad)).toBeNull();
  });
});

describe('criterion 4: owner opened the dashboard', () => {
  const active = ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28'].map((d) => day(d));
  it('passes on 3 of 5 days with activity, not on 2', () => {
    const three = new Set(['2026-10-24', '2026-10-26', '2026-10-28']);
    expect(byKey(scoreScope({ days: active, registrationMs: [], ownerViewDates: three }), 'dashboard')).toMatchObject({
      measured: '3 of 5 days',
      threshold: '3 of 5 days with activity (3 of every 5)',
      label: 'Pass',
    });
    // A view on a day without activity (a Sunday) does not count towards the habit.
    const two = new Set(['2026-10-24', '2026-10-26', '2026-10-23']);
    expect(byKey(scoreScope({ days: active, registrationMs: [], ownerViewDates: two }), 'dashboard')).toMatchObject({ measured: '2 of 5 days', label: 'Not yet' });
  });

  it('counts calendar days, not branch-days, in a total', () => {
    const twoBranches = [day('2026-10-27'), day('2026-10-27'), day('2026-10-28'), day('2026-10-28')];
    const r = byKey(scoreScope({ days: twoBranches, registrationMs: [], ownerViewDates: new Set(['2026-10-27', '2026-10-28']), unit: 'branch-days' }), 'dashboard');
    expect(r).toMatchObject({ measured: '2 of 2 days', label: 'Pass' });
  });
});

describe('criterion 5: days closed', () => {
  it('is information only', () => {
    const r = byKey(scoreScope({ days: [day('2026-10-27', { closed: true }), day('2026-10-28')], registrationMs: [], ownerViewDates: none }), 'closed');
    expect(r).toMatchObject({ measured: '1 of 2 days with activity', threshold: 'No pass mark', label: 'For information' });
    expect(byKey(scoreScope({ days: [], registrationMs: [], ownerViewDates: none }), 'closed').label).toBe('No data');
  });
});

describe('formatting rounds down', () => {
  it('never shows a failing figure as the threshold', () => {
    expect(pctDown(2, 3)).toBe('66.6%');
    expect(pctDown(1, 1)).toBe('100.0%');
    expect(secondsDown(39_999)).toBe('39.9 s');
    expect(secondsDown(25_000)).toBe('25.0 s');
  });
});

describe('the date window', () => {
  const today = '2026-10-28';
  it('defaults to the last 5 days ending today', () => {
    expect(parseWindow({}, today)).toEqual({ from: '2026-10-24', to: '2026-10-28' });
  });
  it('accepts up to 31 days, not in the future', () => {
    expect(parseWindow({ from: '2026-09-28', to: '2026-10-28' }, today)).toEqual({ from: '2026-09-28', to: '2026-10-28' });
    expect(parseWindow({ from: '2026-10-28', to: '2026-10-28' }, today)).toEqual({ from: '2026-10-28', to: '2026-10-28' });
  });
  it('refuses with a reason and falls back to the default', () => {
    const fallback = { from: '2026-10-24', to: '2026-10-28' };
    expect(parseWindow({ from: '2026-09-27', to: '2026-10-28' }, today)).toMatchObject({ ...fallback, error: expect.stringContaining('at most 31 days') });
    expect(parseWindow({ from: '2026-10-27', to: '2026-10-29' }, today)).toMatchObject({ ...fallback, error: expect.stringContaining('future') });
    expect(parseWindow({ from: '2026-10-28', to: '2026-10-27' }, today)).toMatchObject({ ...fallback, error: expect.stringContaining('after the end') });
    expect(parseWindow({ from: '2026-02-30', to: '2026-10-27' }, today).error).toBeTruthy();
    expect(parseWindow({ from: 'x', to: '' }, today).error).toBeTruthy();
  });
});
