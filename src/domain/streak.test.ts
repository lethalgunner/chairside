import { describe, expect, it } from 'vitest';
import { closeStreak, type StreakDay } from './streak';

const d = (date: string, active: boolean, closed: boolean): StreakDay => ({ date, active, closed });

describe('closeStreak (T35)', () => {
  it('counts consecutive closed days back from the latest', () => {
    expect(closeStreak([d('2026-10-26', true, true), d('2026-10-27', true, true), d('2026-10-28', true, true)], '2026-10-28')).toBe(3);
  });

  it('stops at an active day that was not closed', () => {
    expect(closeStreak([d('2026-10-25', true, true), d('2026-10-26', true, false), d('2026-10-27', true, true), d('2026-10-28', true, true)], '2026-10-28')).toBe(2);
  });

  it('skips days with no activity, like a Sunday', () => {
    expect(closeStreak([d('2026-10-24', true, true), d('2026-10-25', false, false), d('2026-10-26', true, true)], '2026-10-26')).toBe(2);
  });

  it('does not let today, still open, break the streak', () => {
    expect(closeStreak([d('2026-10-27', true, true), d('2026-10-28', true, false)], '2026-10-28')).toBe(1);
  });

  it('counts a closed day even if nothing was billed (a close with zero activity)', () => {
    expect(closeStreak([d('2026-10-27', false, true), d('2026-10-28', true, true)], '2026-10-28')).toBe(2);
  });

  it('is zero with no closes and ignores order and future dates', () => {
    expect(closeStreak([], '2026-10-28')).toBe(0);
    expect(closeStreak([d('2026-10-29', true, true), d('2026-10-27', true, false)], '2026-10-28')).toBe(0);
  });
});
