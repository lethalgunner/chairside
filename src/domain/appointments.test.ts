import { describe, expect, it } from 'vitest';
import { canMoveAppointment, checkBooking, freeSlots, istInstant, isoWeekday } from './appointments';

describe('appointments (LET-167)', () => {
  it('turns an IST clinic time into the right instant', () => {
    expect(istInstant('2026-11-09', '11:00').toISOString()).toBe('2026-11-09T05:30:00.000Z');
    expect(istInstant('2026-11-09', '00:15').toISOString()).toBe('2026-11-08T18:45:00.000Z');
  });
  it('knows the weekday', () => {
    expect(isoWeekday('2026-11-09')).toBe(1);
    expect(isoWeekday('2026-11-08')).toBe(7);
  });
  it('lists free slots around bookings and hides started ones', () => {
    const busy = [{ start: 11 * 60, end: 11 * 60 + 30 }];
    const s = freeSlots({ startTime: '10:00', endTime: '12:00', slotMinutes: 15, busy });
    expect(s).toEqual(['10:00', '10:15', '10:30', '10:45', '11:30', '11:45']);
    expect(freeSlots({ startTime: '10:00', endTime: '12:00', slotMinutes: 15, busy, after: 10 * 60 + 40 })).toEqual(['10:45', '11:30', '11:45']);
    // A 20-minute booking at 10:05 blocks the slots it touches.
    expect(freeSlots({ startTime: '10:00', endTime: '11:00', slotMinutes: 15, busy: [{ start: 605, end: 625 }] })).toEqual(['10:30', '10:45']);
    expect(freeSlots({ startTime: '10:00', endTime: '10:10', slotMinutes: 15, busy: [] })).toEqual([]);
  });
  it('checks a booking', () => {
    const ok = checkBooking({ date: '2026-11-09', time: '11:00', minutes: 15, reason: '  RCT   sitting 2 ' }, '2026-11-08');
    expect(ok.ok && ok.value).toMatchObject({ reason: 'RCT sitting 2' });
    expect(ok.ok && ok.value.endsAt.toISOString()).toBe('2026-11-09T05:45:00.000Z');
    const bad = checkBooking({ date: '2026-11-07', time: '11:03', minutes: 7, reason: 'x'.repeat(81) }, '2026-11-08');
    expect(!bad.ok && Object.keys(bad.fieldErrors).sort()).toEqual(['date', 'minutes', 'reason', 'time']);
    expect(checkBooking({ date: '2026-13-40', time: '25:00', minutes: 15, reason: '' }, '2026-11-08').ok).toBe(false);
  });
  it('moves status only along allowed paths', () => {
    expect(canMoveAppointment('booked', 'arrived')).toBe(true);
    expect(canMoveAppointment('no_show', 'booked')).toBe(true);
    expect(canMoveAppointment('cancelled', 'booked')).toBe(false);
    expect(canMoveAppointment('completed', 'cancelled')).toBe(false);
  });
});
