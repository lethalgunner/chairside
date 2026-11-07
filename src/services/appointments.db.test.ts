import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { appointments, auditLog, visits } from '@/db/schema';
import { addDays, businessDate } from '@/domain/dates';
import { createFixture, type Fixture } from '@/test/fixtures';
import { bookAppointment, calendarFeed, dayAppointments, doctorDays, markArrived, rescheduleAppointment, setAppointmentStatus, upcomingForPatient } from './appointments';
import { ForbiddenError, UserFacingError } from './context';
import { registerPatient } from './patients';
import { issueCalendarToken, revokeCalendarToken, setProviderActive } from './providers';

let f: Fixture;
let other: Fixture;
const today = businessDate();
// Tomorrow, or the day after if tomorrow is a Sunday (fixture doctors work Mon–Sat).
let day = addDays(today, 1);
if (new Date(`${day}T00:00:00Z`).getUTCDay() === 0) day = addDays(day, 1);

async function patient(ctx = f.ctx('desk')): Promise<string> {
  const phone = `95${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const r = await registerPatient(ctx, { fullName: `Appt ${phone}`, phone, sex: 'F', age: 30, acknowledgedDuplicate: true });
  if (!r.ok) throw new Error('registration failed');
  return r.patientId;
}
const book = (time: string, providerId = f.doctorId, patientId?: string, date = day) =>
  (async () => bookAppointment(f.ctx('desk'), { patientId: patientId ?? (await patient()), providerId, date, time, minutes: 0, reason: 'Check-up' }))();

beforeAll(async () => {
  f = await createFixture();
  other = await createFixture();
});
afterAll(async () => {
  await closeDb();
});

describe('appointments (LET-167)', () => {
  let first: string;

  it('books a slot at the doctor’s slot length and shows it on the day and in free slots', async () => {
    const r = await book('11:00');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    first = r.id;
    const [a] = await getDb().select().from(appointments).where(eq(appointments.id, first));
    expect(a!.startsAt.toISOString()).toBe(new Date(`${day}T11:00:00+05:30`).toISOString());
    expect(a!.endsAt.getTime() - a!.startsAt.getTime()).toBe(15 * 60_000);
    const list = await dayAppointments(f.ctx('desk'), [f.pune.id], day);
    expect(list.map((x) => [x.time, x.providerName, x.status])).toEqual([['11:00', 'Dr Associate', 'booked']]);
    const docs = await doctorDays(f.ctx('desk'), f.pune.id, day);
    const assoc = docs.find((d) => d.providerId === f.doctorId)!;
    expect(assoc.hours).toEqual({ startTime: '10:00', endTime: '19:00' });
    expect(assoc.free).toContain('10:45');
    expect(assoc.free).not.toContain('11:00');
    expect(assoc.free).toContain('11:15');
  });

  it('refuses a double booking for the same doctor; the next slot and another doctor are fine', async () => {
    const clash = await book('11:05');
    expect(clash).toMatchObject({ ok: false, fieldErrors: { time: expect.stringContaining('already has someone from 11:00 to 11:15') } });
    expect((await book('11:15')).ok).toBe(true);
    expect((await book('11:00', f.ownerProviderId)).ok).toBe(true);
  });

  it('two desks booking the same slot at the same moment: exactly one wins', async () => {
    const [a, b] = await Promise.all([book('15:00'), book('15:00')]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });

  it('refuses past dates, bad times and a doctor who does not work at the branch', async () => {
    const past = await book('11:00', f.doctorId, undefined, addDays(today, -1));
    expect(past).toMatchObject({ ok: false, fieldErrors: { date: expect.any(String) } });
    const kanpur = await bookAppointment(f.ctx('kanpurDesk'), { patientId: await patient(f.ctx('kanpurDesk')), providerId: f.doctorId, date: day, time: '11:00', minutes: 15, reason: '' });
    expect(kanpur).toMatchObject({ ok: false, fieldErrors: { providerId: expect.any(String) } });
  });

  it('moves, then cancel needs a reason and frees the slot', async () => {
    expect(await rescheduleAppointment(f.ctx('desk'), first, { providerId: f.doctorId, date: day, time: '12:00', minutes: 30, reason: 'RCT sitting 2' })).toEqual({ ok: true, id: first });
    expect((await book('11:00')).ok).toBe(true); // the old time is free again
    await expect(setAppointmentStatus(f.ctx('desk'), first, 'cancelled', '')).rejects.toBeInstanceOf(UserFacingError);
    await setAppointmentStatus(f.ctx('desk'), first, 'cancelled', 'Patient travelling');
    expect((await book('12:00')).ok).toBe(true);
    await expect(rescheduleAppointment(f.ctx('desk'), first, { providerId: f.doctorId, date: day, time: '13:00', minutes: 15, reason: '' })).rejects.toBeInstanceOf(UserFacingError);
    const audit = await getDb().select().from(auditLog).where(eq(auditLog.entityId, first));
    expect(audit.map((x) => x.action).sort()).toEqual(['appointment.book', 'appointment.cancelled', 'appointment.move']);
  });

  it('no-show can be undone, unless someone has taken the slot since', async () => {
    const r = await book('16:00');
    if (!r.ok) throw new Error('not booked');
    await setAppointmentStatus(f.ctx('desk'), r.id, 'no_show');
    await setAppointmentStatus(f.ctx('desk'), r.id, 'booked');
    await setAppointmentStatus(f.ctx('desk'), r.id, 'no_show');
    expect((await book('16:00')).ok).toBe(true);
    await expect(setAppointmentStatus(f.ctx('desk'), r.id, 'booked')).rejects.toBeInstanceOf(UserFacingError);
  });

  it('arrived puts today’s patient in the waiting room, linked to the appointment', async () => {
    const pid = await patient();
    const r = await book('23:50', f.doctorId, pid, today);
    if (!r.ok) throw new Error(JSON.stringify(r));
    const { token } = await markArrived(f.ctx('desk'), r.id);
    expect(token).toBeGreaterThan(0);
    const [v] = await getDb().select().from(visits).where(and(eq(visits.appointmentId, r.id), eq(visits.patientId, pid)));
    expect(v).toMatchObject({ token, status: 'waiting' });
    const [a] = await getDb().select().from(appointments).where(eq(appointments.id, r.id));
    expect(a!.status).toBe('arrived');
    expect((await upcomingForPatient(f.ctx('desk'), pid))[0]).toMatchObject({ status: 'arrived', branchName: 'Pune' });
    // Tomorrow's appointment can't be marked arrived today.
    const later = await book('10:00');
    if (!later.ok) throw new Error('not booked');
    await expect(markArrived(f.ctx('desk'), later.id)).rejects.toBeInstanceOf(UserFacingError);
  });

  it('accountants and other orgs are refused', async () => {
    await expect(bookAppointment(f.ctx('accountant', f.pune.id), { patientId: await patient(), providerId: f.doctorId, date: day, time: '17:00', minutes: 15, reason: '' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setAppointmentStatus(other.ctx('owner', other.pune.id), first, 'no_show')).rejects.toBeInstanceOf(ForbiddenError);
    expect(await dayAppointments(other.ctx('owner', other.pune.id), [f.pune.id], day)).toEqual([]);
    const cross = await bookAppointment(other.ctx('owner', other.pune.id), { patientId: await patient(other.ctx('desk')), providerId: f.doctorId, date: day, time: '17:00', minutes: 15, reason: '' });
    expect(cross).toMatchObject({ ok: false, fieldErrors: { providerId: expect.any(String) } });
  });

  it('calendar feed: the doctor’s times and branch, no patient names; cancelled drop out; revoked links stop', async () => {
    const token = await issueCalendarToken(f.ctx('owner'), f.doctorId);
    const feed = await calendarFeed(token);
    expect(feed?.name).toBe('Dr Associate');
    expect(feed!.events.length).toBeGreaterThan(3);
    expect(feed!.events.every((e) => e.location === 'Pune' && /^Appointment · \d+ min$/.test(e.summary))).toBe(true);
    expect(JSON.stringify(feed)).not.toMatch(/Appt \d|Check-up|RCT/);
    expect(feed!.events.map((e) => e.uid)).not.toContain(`${first}@chairside`); // cancelled
    expect(await calendarFeed('x'.repeat(43))).toBeNull();
    expect(await calendarFeed('../../etc')).toBeNull();
    await setProviderActive(f.ctx('owner'), f.doctorId, false);
    expect(await calendarFeed(token)).toBeNull();
    await setProviderActive(f.ctx('owner'), f.doctorId, true);
    await revokeCalendarToken(f.ctx('owner'), f.doctorId);
    expect(await calendarFeed(token)).toBeNull();
  });
});
