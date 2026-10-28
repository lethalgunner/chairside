import { describe, expect, it } from 'vitest';
import { businessDate, isIsoDate, MAX_DAYS_BACK, resolveViewDate, shortDay } from './dates';

const today = '2026-10-28';

describe('resolveViewDate: past days are read-only views (Q19, T27)', () => {
  it('honours an ISO date before today', () => {
    expect(resolveViewDate('2026-10-27', today)).toEqual({ date: '2026-10-27', isToday: false });
    expect(resolveViewDate(' 2026-10-24 ', today)).toEqual({ date: '2026-10-24', isToday: false });
  });

  it('treats today itself, and no parameter, as today', () => {
    expect(resolveViewDate('2026-10-28', today)).toEqual({ date: today, isToday: true });
    expect(resolveViewDate(undefined, today)).toEqual({ date: today, isToday: true });
    expect(resolveViewDate(null, today)).toEqual({ date: today, isToday: true });
    expect(resolveViewDate('', today)).toEqual({ date: today, isToday: true });
  });

  it('never shows a future day', () => {
    expect(resolveViewDate('2026-10-29', today)).toEqual({ date: today, isToday: true });
    expect(resolveViewDate('2027-01-01', today)).toEqual({ date: today, isToday: true });
  });

  it(`allows exactly ${MAX_DAYS_BACK} days back and no further`, () => {
    expect(resolveViewDate('2025-09-23', today)).toEqual({ date: '2025-09-23', isToday: false });
    expect(resolveViewDate('2025-09-22', today)).toEqual({ date: today, isToday: true });
  });

  it('falls back to today on anything that is not a real ISO date', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '26-10-27', '2026-10-7', '27/10/2026', 'yesterday', "2026-10-27' or 1=1", '2026-10-27T00:00']) {
      expect(resolveViewDate(bad, today), bad).toEqual({ date: today, isToday: true });
    }
    // A repeated ?date=…&date=… arrives as an array.
    expect(resolveViewDate(['2026-10-27', '2026-10-26'], today)).toEqual({ date: today, isToday: true });
  });

  it('uses the IST business date when no today is given', () => {
    expect(resolveViewDate(undefined).date).toBe(businessDate());
  });

  it('crosses month and leap-year boundaries', () => {
    expect(resolveViewDate('2028-02-29', '2028-03-01')).toEqual({ date: '2028-02-29', isToday: false });
    expect(isIsoDate('2027-02-29')).toBe(false);
  });
});

describe('shortDay', () => {
  it('names the weekday', () => {
    expect(shortDay('2026-10-24')).toBe('Sat 24 Oct');
    expect(shortDay('2026-10-23')).toBe('Fri 23 Oct');
    expect(shortDay('2027-01-01')).toBe('Fri 1 Jan');
  });
});
