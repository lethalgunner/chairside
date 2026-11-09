import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { auditLog } from '@/db/schema';
import { addDays, businessDate } from '@/domain/dates';
import { createFixture, type Fixture } from '@/test/fixtures';
import { bookAppointment, doctorDays, rescheduleAppointment } from './appointments';
import { ForbiddenError } from './context';
import { addLeave, leavePage, removeLeave } from './leave';
import { registerPatient } from './patients';
import { setProviderHours } from './providers';

let f: Fixture;
let other: Fixture;
const today = businessDate();
// A working day (fixture doctors work Mon–Sat) well ahead, and the next working day after it.
const workday = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() === 0 ? addDays(d, 1) : d);
const away = workday(addDays(today, 10));
const back = workday(addDays(away, 1));

async function patient(ctx = f.ctx('desk')): Promise<string> {
  const phone = `94${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const r = await registerPatient(ctx, { fullName: `Leave ${phone}`, phone, sex: 'F', age: 40, acknowledgedDuplicate: true });
  if (!r.ok) throw new Error('registration failed');
  return r.patientId;
}

beforeAll(async () => {
  f = await createFixture();
  other = await createFixture();
});
afterAll(async () => {
  await closeDb();
});

describe('doctor leave (Sprint 8)', () => {
  let leaveId: string;
  let booked: string;
  let later: string;

  it('before any leave, nothing changes: free times show and booking works', async () => {
    const docs = await doctorDays(f.ctx('desk'), f.pune.id, away);
    const doc = docs.find((d) => d.providerId === f.doctorId)!;
    expect(doc.leave).toBeNull();
    expect(doc.free.length).toBeGreaterThan(0);
    const r = await bookAppointment(f.ctx('desk'), { patientId: await patient(), providerId: f.doctorId, date: away, time: '11:00', minutes: 0, reason: '' });
    expect(r.ok).toBe(true);
    if (r.ok) booked = r.id;
    const r2 = await bookAppointment(f.ctx('desk'), { patientId: await patient(), providerId: f.doctorId, date: back, time: '11:00', minutes: 0, reason: '' });
    expect(r2.ok).toBe(true);
    if (r2.ok) later = r2.id;
  });

  it('the desk records leave; the existing booking is listed to move, not cancelled', async () => {
    const r = await addLeave(f.ctx('desk'), f.doctorId, { from: away, to: away, note: 'Conference' });
    expect(r).toMatchObject({ ok: true, toMove: 1 });
    if (!r.ok) return;
    leaveId = r.id;
    const page = await leavePage(f.ctx('desk'));
    expect(page.leaves.map((l) => [l.providerId, l.startsOn, l.endsOn, l.note])).toEqual([[f.doctorId, away, away, 'Conference']]);
    expect(page.toMove.map((a) => [a.id, a.date, a.time])).toEqual([[booked, away, '11:00']]);
    const [audit] = await getDb().select().from(auditLog).where(and(eq(auditLog.orgId, f.orgId), eq(auditLog.action, 'provider.leave_add')));
    expect(audit).toBeTruthy();
  });

  it('that day shows no free times and refuses new bookings and moves into it; other days are untouched', async () => {
    const doc = (await doctorDays(f.ctx('desk'), f.pune.id, away)).find((d) => d.providerId === f.doctorId)!;
    expect(doc.leave).toMatchObject({ startsOn: away, endsOn: away });
    expect(doc.free).toEqual([]);
    const refused = await bookAppointment(f.ctx('desk'), { patientId: await patient(), providerId: f.doctorId, date: away, time: '15:00', minutes: 0, reason: '' });
    expect(refused).toMatchObject({ ok: false, fieldErrors: { date: expect.stringContaining('is on leave') } });
    // Kanpur too: leave applies at every branch the doctor works at.
    await setProviderHours(f.ctx('owner'), f.doctorId, f.kanpur.id, { days: [1, 2, 3, 4, 5, 6], startTime: '10:00', endTime: '19:00' });
    const kanpur = await bookAppointment(f.ctx('kanpurDesk'), { patientId: await patient(f.ctx('kanpurDesk')), providerId: f.doctorId, date: away, time: '15:00', minutes: 0, reason: '' });
    expect(kanpur).toMatchObject({ ok: false, fieldErrors: { date: expect.stringContaining('is on leave') } });
    const move = await rescheduleAppointment(f.ctx('desk'), later, { providerId: f.doctorId, date: away, time: '16:00', minutes: 0, reason: '' });
    expect(move).toMatchObject({ ok: false, fieldErrors: { date: expect.stringContaining('is on leave') } });
    // Moving the stranded booking out of the leave works and clears "to move".
    expect(await rescheduleAppointment(f.ctx('desk'), booked, { providerId: f.doctorId, date: back, time: '12:00', minutes: 0, reason: '' })).toEqual({ ok: true, id: booked });
    expect((await leavePage(f.ctx('desk'))).toMove).toEqual([]);
    const nextDay = (await doctorDays(f.ctx('desk'), f.pune.id, back)).find((d) => d.providerId === f.doctorId)!;
    expect(nextDay.leave).toBeNull();
    expect(nextDay.free.length).toBeGreaterThan(0);
  });

  it('who may: not the accountant, not another clinic; past dates refused', async () => {
    await expect(addLeave(f.ctx('accountant'), f.doctorId, { from: away, to: away })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addLeave(other.ctx('owner'), f.doctorId, { from: away, to: away })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(removeLeave(other.ctx('owner'), leaveId)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await leavePage(other.ctx('owner'))).leaves).toEqual([]);
    const past = await addLeave(f.ctx('desk'), f.doctorId, { from: addDays(today, -1), to: today });
    expect(past).toMatchObject({ ok: false, fieldErrors: { from: expect.any(String) } });
  });

  it('removing leave opens the day again, and is audited', async () => {
    await removeLeave(f.ctx('desk'), leaveId);
    await removeLeave(f.ctx('desk'), leaveId); // twice is harmless
    expect((await leavePage(f.ctx('desk'))).leaves).toEqual([]);
    const doc = (await doctorDays(f.ctx('desk'), f.pune.id, away)).find((d) => d.providerId === f.doctorId)!;
    expect(doc.leave).toBeNull();
    expect(doc.free).toContain('15:00');
    const removed = await getDb().select().from(auditLog).where(and(eq(auditLog.orgId, f.orgId), eq(auditLog.action, 'provider.leave_remove')));
    expect(removed).toHaveLength(1);
  });
});
