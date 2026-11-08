import { describe, expect, it } from 'vitest';
import { canMoveVisit, defaultDueOn, dueInWords, recallBucket, recallReminderText, waitLabel, minutesBetween } from './visits';

describe('waiting room (T36)', () => {
  it('moves forward, with one undo from the chair', () => {
    expect(canMoveVisit('waiting', 'in_chair')).toBe(true);
    expect(canMoveVisit('waiting', 'left')).toBe(true);
    expect(canMoveVisit('in_chair', 'done')).toBe(true);
    expect(canMoveVisit('in_chair', 'waiting')).toBe(true);
    expect(canMoveVisit('done', 'waiting')).toBe(false);
    expect(canMoveVisit('left', 'in_chair')).toBe(false);
    expect(canMoveVisit('in_chair', 'left')).toBe(false);
  });

  it('labels waiting time', () => {
    expect(waitLabel(4)).toBe('4 min');
    expect(waitLabel(65)).toBe('1 h 05 min');
    expect(minutesBetween(new Date('2026-10-29T10:00:00Z'), new Date('2026-10-29T10:12:59Z'))).toBe(12);
    expect(minutesBetween(new Date('2026-10-29T10:00:00Z'), new Date('2026-10-29T09:00:00Z'))).toBe(0);
  });
});

describe('recalls (T37)', () => {
  it('pre-fills a sensible date per kind', () => {
    expect(defaultDueOn('checkup', '2026-10-29')).toBe('2027-04-29');
    expect(defaultDueOn('continue', '2026-10-29')).toBe('2026-11-05');
    expect(defaultDueOn('review', '2026-12-15')).toBe('2027-01-14');
  });

  it('buckets by due date', () => {
    const t = '2026-10-29';
    expect(recallBucket('2026-10-28', t)).toBe('overdue');
    expect(recallBucket(t, t)).toBe('today');
    expect(recallBucket('2026-11-05', t)).toBe('this_week');
    expect(recallBucket('2026-11-06', t)).toBe('later');
  });

  it('reminds without naming a treatment', () => {
    const t = recallReminderText({ firstName: 'Meena', branchName: 'Demo Pune', branchPhone: '020 1234 5678', overdue: true });
    expect(t).toBe("Namaste Meena,\nThis is a reminder from Demo Pune: your next visit with us was due. We'd be happy to see you.\nPlease call us on 020 1234 5678 to book a time. Thank you!");
    expect(recallReminderText({ firstName: 'Ravi', branchName: 'B', branchPhone: null, overdue: false })).toContain('is due soon');
  });
});

describe('due date in words (QA 9 Nov)', () => {
  it('explains the defaults', () => {
    expect(dueInWords('2026-11-09', defaultDueOn('checkup', '2026-11-09'))).toBe('in about 6 months');
    expect(dueInWords('2026-11-09', defaultDueOn('continue', '2026-11-09'))).toBe('in 1 week');
    expect(dueInWords('2026-11-09', defaultDueOn('review', '2026-11-09'))).toBe('in about 4 weeks');
  });
  it('handles near and past dates', () => {
    expect(dueInWords('2026-11-09', '2026-11-09')).toBe('today');
    expect(dueInWords('2026-11-09', '2026-11-10')).toBe('tomorrow');
    expect(dueInWords('2026-11-09', '2026-11-12')).toBe('in 3 days');
    expect(dueInWords('2026-11-09', '2026-11-23')).toBe('in about 2 weeks');
    expect(dueInWords('2026-11-09', '2026-11-01')).toBe('overdue');
    expect(dueInWords('2026-11-09', '2026-12-09')).toBe('in about 4 weeks');
    expect(dueInWords('2026-11-09', '2027-01-09')).toBe('in about 2 months');
  });
});
