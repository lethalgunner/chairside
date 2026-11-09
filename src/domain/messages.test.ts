import { describe, expect, it } from 'vitest';
import {
  afterQuiet,
  checkQuiet,
  checkRule,
  checkTemplate,
  DEFAULT_QUIET,
  missingFor,
  pickQueue,
  planAppointment,
  planDues,
  planRecall,
  planVisit,
  renderMessage,
  timingWords,
  type PlannedRule,
} from './messages';

const ist = (d: string, t: string) => new Date(`${d}T${t}:00+05:30`);
const rule = (id: string, r: Partial<PlannedRule> & Pick<PlannedRule, 'trigger'>): PlannedRule => ({ id, offsetMinutes: 0, everyDays: null, maxTimes: null, ...r });

describe('checkTemplate', () => {
  it('accepts known details and trims', () => {
    expect(checkTemplate({ name: ' Reminder ', language: 'en', body: ' Namaste {first_name}, see you {date} at {time}. ' }, { doctorAllowed: false })).toEqual({
      ok: true,
      value: { name: 'Reminder', language: 'en', body: 'Namaste {first_name}, see you {date} at {time}.' },
    });
  });
  it('refuses unknown details, {doctor} unless switched on, empty or long bodies, other languages', () => {
    const r = checkTemplate({ name: 'x', language: 'fr', body: 'Hi {treatment}' }, { doctorAllowed: true });
    expect(r.ok ? [] : Object.keys(r.fieldErrors).sort()).toEqual(['body', 'language', 'name']);
    expect(r.ok ? '' : r.fieldErrors.body).toMatch(/\{treatment\}/);
    const doc = checkTemplate({ name: 'Doc', language: 'hi', body: 'With {doctor}' }, { doctorAllowed: false });
    expect(doc.ok ? '' : doc.fieldErrors.body).toMatch(/switched off/);
    expect(checkTemplate({ name: 'Doc', language: 'hi', body: 'With {doctor}' }, { doctorAllowed: true }).ok).toBe(true);
    expect(checkTemplate({ name: 'Long', language: 'en', body: 'a'.repeat(1001) }, { doctorAllowed: false }).ok).toBe(false);
  });
  it('missingFor: money details make no sense on an appointment reminder', () => {
    expect(missingFor('before_appointment', 'Pay {amount_due} by {time}')).toEqual(['amount_due']);
    expect(missingFor('dues', 'Pay {amount_due} to {upi_id}')).toEqual([]);
  });
});

describe('renderMessage', () => {
  it('fills details and drops a line whose details are all missing', () => {
    const body = 'Namaste {first_name},\nSee you on {date} at {time}.\nAddress: {address}\nCall us on {phone}.';
    expect(renderMessage(body, { first_name: 'Rahul', date: 'Mon 9 Nov', time: '11:00', address: null, phone: '020 1234' })).toBe('Namaste Rahul,\nSee you on Mon 9 Nov at 11:00.\nCall us on 020 1234.');
  });
  it('a line with one detail present keeps it; lines without details always stay', () => {
    expect(renderMessage('Thanks!\n{branch} {phone}', { branch: 'Pune', phone: '' })).toBe('Thanks!\nPune');
  });
});

describe('checkRule and timingWords', () => {
  it('before an appointment: 5 minutes to 14 days', () => {
    expect(checkRule({ trigger: 'before_appointment', amount: '1', unit: 'hours', templateId: 't' })).toEqual({ ok: true, value: { trigger: 'before_appointment', offsetMinutes: 60, everyDays: null, maxTimes: null } });
    expect(checkRule({ trigger: 'before_appointment', amount: '4', unit: 'minutes', templateId: 't' }).ok).toBe(false);
    expect(checkRule({ trigger: 'before_appointment', amount: '15', unit: 'days', templateId: 't' }).ok).toBe(false);
  });
  it('dues: every 1–60 days, 1–10 times; after a visit and come-back use days', () => {
    expect(checkRule({ trigger: 'dues', amount: '', unit: '', everyDays: '7', maxTimes: '3', templateId: 't' })).toMatchObject({ ok: true, value: { everyDays: 7, maxTimes: 3 } });
    const bad = checkRule({ trigger: 'dues', amount: '', unit: '', everyDays: '0', maxTimes: '11', templateId: 't' });
    expect(bad.ok ? [] : Object.keys(bad.fieldErrors).sort()).toEqual(['everyDays', 'maxTimes']);
    expect(checkRule({ trigger: 'after_visit', amount: '2', unit: 'hours', templateId: 't' }).ok).toBe(false);
    expect(checkRule({ trigger: 'nope', amount: '1', unit: 'days', templateId: 't' }).ok).toBe(false);
  });
  it('words', () => {
    expect(timingWords({ trigger: 'before_appointment', offsetMinutes: 1440, everyDays: null, maxTimes: null })).toBe('1 day before');
    expect(timingWords({ trigger: 'before_appointment', offsetMinutes: 180, everyDays: null, maxTimes: null })).toBe('3 hours before');
    expect(timingWords({ trigger: 'dues', offsetMinutes: 0, everyDays: 7, maxTimes: 3 })).toBe('Every 7 days while money is owed, up to 3 times');
  });
});

describe('quiet hours', () => {
  it('checkQuiet refuses equal times', () => {
    expect(checkQuiet('21:00', '21:00').ok).toBe(false);
    expect(checkQuiet('22:00', '07:30')).toEqual({ ok: true, value: { start: '22:00', end: '07:30' } });
  });
  it('a time in quiet hours moves to 08:00: late evening to the next morning, early morning to the same morning', () => {
    expect(afterQuiet(ist('2026-11-09', '22:30'), DEFAULT_QUIET)).toEqual(ist('2026-11-10', '08:00'));
    expect(afterQuiet(ist('2026-11-09', '06:00'), DEFAULT_QUIET)).toEqual(ist('2026-11-09', '08:00'));
    expect(afterQuiet(ist('2026-11-09', '12:00'), DEFAULT_QUIET)).toEqual(ist('2026-11-09', '12:00'));
  });
});

describe('planAppointment', () => {
  const booked = rule('rb', { trigger: 'booked' });
  const dayBefore = rule('r1d', { trigger: 'before_appointment', offsetMinutes: 1440 });
  const hourBefore = rule('r1h', { trigger: 'before_appointment', offsetMinutes: 60 });
  const appt = { id: 'a1', startsAt: ist('2026-11-12', '11:00'), status: 'booked', plannedFrom: ist('2026-11-09', '15:00') };

  it('Clinic B style: booking + 1 day + 1 hour before, at the right times', () => {
    const due = planAppointment(appt, [booked, dayBefore, hourBefore], DEFAULT_QUIET);
    expect(due.map((d) => [d.ruleId, d.dueAt.toISOString()])).toEqual([
      ['rb', ist('2026-11-09', '15:00').toISOString()],
      ['r1d', ist('2026-11-11', '11:00').toISOString()],
      ['r1h', ist('2026-11-12', '10:00').toISOString()],
    ]);
    expect(due.every((d) => d.expiresAt.getTime() === appt.startsAt.getTime())).toBe(true);
  });
  it('a reminder that would fall before the booking was made is skipped, not sent late', () => {
    const late = { ...appt, plannedFrom: ist('2026-11-12', '09:30') };
    expect(planAppointment(late, [dayBefore, hourBefore], DEFAULT_QUIET).map((d) => d.ruleId)).toEqual(['r1h']);
  });
  it('quiet hours: 1 hour before an 08:30 start goes at 08:00; 2 hours before a 07:45 start goes the evening before', () => {
    const early = { ...appt, startsAt: ist('2026-11-12', '08:30') };
    expect(planAppointment(early, [hourBefore], DEFAULT_QUIET)[0]!.dueAt).toEqual(ist('2026-11-12', '08:00'));
    const two = rule('r2h', { trigger: 'before_appointment', offsetMinutes: 120 });
    const nine = { ...appt, startsAt: ist('2026-11-12', '07:45') };
    expect(planAppointment(nine, [two], DEFAULT_QUIET)[0]!.dueAt).toEqual(ist('2026-11-11', '20:45'));
  });
  it('a moved appointment gets new keys; cancelled gets none; no-show gets its own', () => {
    const k1 = planAppointment(appt, [dayBefore], DEFAULT_QUIET)[0]!.key;
    const k2 = planAppointment({ ...appt, startsAt: ist('2026-11-13', '11:00') }, [dayBefore], DEFAULT_QUIET)[0]!.key;
    expect(k1).not.toBe(k2);
    expect(planAppointment({ ...appt, status: 'cancelled' }, [booked, dayBefore], DEFAULT_QUIET)).toEqual([]);
    const ns = rule('rns', { trigger: 'no_show', offsetMinutes: 120 });
    expect(planAppointment({ ...appt, status: 'no_show' }, [booked, ns], DEFAULT_QUIET).map((d) => [d.ruleId, d.dueAt.toISOString()])).toEqual([['rns', ist('2026-11-12', '13:00').toISOString()]]);
  });
  it('never more than 6 per appointment', () => {
    const many = Array.from({ length: 8 }, (_, i) => rule(`r${i}`, { trigger: 'before_appointment', offsetMinutes: (i + 1) * 60 }));
    expect(planAppointment({ ...appt, plannedFrom: ist('2026-11-01', '12:00') }, many, DEFAULT_QUIET)).toHaveLength(6);
  });
});

describe('day-based plans', () => {
  it('after a visit, come-back due, money owed', () => {
    const v = planVisit({ id: 'v1', patientId: 'p1', date: '2026-11-09' }, [rule('rv', { trigger: 'after_visit', offsetMinutes: 1440 })], DEFAULT_QUIET);
    expect(v[0]!.dueAt).toEqual(ist('2026-11-10', '10:00'));
    const c = planRecall({ id: 'c1', dueOn: '2026-12-01' }, [rule('rc', { trigger: 'recall_due', offsetMinutes: 2 * 1440 })], DEFAULT_QUIET);
    expect(c[0]!.dueAt).toEqual(ist('2026-11-29', '10:00'));
    const d = planDues({ patientId: 'p1', branchId: 'b1', oldestOpen: '2026-11-01' }, [rule('rd', { trigger: 'dues', everyDays: 7, maxTimes: 3 })], DEFAULT_QUIET);
    expect(d.map((x) => x.dueAt)).toEqual([ist('2026-11-08', '10:00'), ist('2026-11-15', '10:00'), ist('2026-11-22', '10:00')]);
    expect(new Set(d.map((x) => x.key)).size).toBe(3);
  });
});

describe('pickQueue', () => {
  const now = ist('2026-11-11', '12:00');
  const d = (key: string, group: string, due: string, exp = '2026-11-20') => ({ ruleId: 'r', key, group, dueAt: new Date(due), expiresAt: ist(exp, '00:00') });
  it('latest due per group, sent ones gone, expired gone, later today listed separately, tomorrow not shown', () => {
    const all = [
      d('a-3d', 'appt:a', ist('2026-11-09', '11:00').toISOString()),
      d('a-1d', 'appt:a', ist('2026-11-11', '11:00').toISOString()),
      d('a-1h', 'appt:a', ist('2026-11-12', '10:00').toISOString()),
      d('b-1d', 'appt:b', ist('2026-11-11', '09:00').toISOString()),
      d('c-old', 'appt:c', ist('2026-11-10', '09:00').toISOString(), '2026-11-11'),
      d('e-later', 'appt:e', ist('2026-11-11', '16:00').toISOString()),
    ];
    const q = pickQueue(all, new Set(['b-1d']), now);
    expect(q.dueNow.map((x) => x.key)).toEqual(['a-1d']);
    expect(q.laterToday.map((x) => x.key)).toEqual(['e-later']);
  });
});
