import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { auditLog, patients, recalls, sessions, users, visits } from '@/db/schema';
import { addDays, businessDate } from '@/domain/dates';
import { redeemInvite } from '@/lib/auth/invite';
import { signInWithPassword } from '@/lib/auth/session';
import { createFixture, key, type Fixture } from '@/test/fixtures';
import { ForbiddenError, UserFacingError, type TenantContext } from './context';
import { exportCsv } from './export';
import { issueBill } from './invoices';
import { getPatientDetails, registerPatient, updatePatient } from './patients';
import { closeRecall, logRecallReminder, openRecalls, setRecall } from './recalls';
import { passwordResetLink } from './staff';
import { addToQueue, moveVisit, queueFor } from './visits';

/** Sprint 3: patient edit (T38), reset link (T39), export (T40), waiting room (T36), recalls (T37). */
let f: Fixture;
let other: Fixture;

async function patient(ctx: TenantContext, name = 'Kiran Patel', phone = `93${Math.floor(10_000_000 + Math.random() * 89_999_999)}`): Promise<string> {
  const p = await registerPatient(ctx, { fullName: name, phone, sex: 'M', age: 30, acknowledgedDuplicate: true });
  if (!p.ok) throw new Error('registration failed');
  return p.patientId;
}

const edit = (o: Partial<{ fullName: string; phone: string; age: number; ack: boolean }> = {}) => ({
  fullName: o.fullName ?? 'Kiran Patel',
  phone: o.phone ?? '9300000001',
  sex: 'M' as const,
  age: o.age ?? 30,
  referralSource: 'Walk-in',
  acknowledgedDuplicate: o.ack ?? false,
});

beforeAll(async () => {
  f = await createFixture();
  other = await createFixture();
});
afterAll(async () => {
  await closeDb();
});

describe('Edit patient details (T38)', () => {
  it('fixes a typo and audits only what changed', async () => {
    const desk = f.ctx('desk');
    const id = await patient(desk, 'Kiran Patl', '9300000001');
    const res = await updatePatient(desk, id, edit({ fullName: '  Kiran   Patel ' }));
    expect(res).toEqual({ ok: true, changed: ['fullName'] });
    expect((await getPatientDetails(desk, id))?.fullName).toBe('Kiran Patel');
    const [a] = await getDb().select().from(auditLog).where(and(eq(auditLog.entityId, id), eq(auditLog.action, 'patient.edit')));
    expect(a!.before).toEqual({ fullName: 'Kiran Patl' });
    expect(a!.after).toEqual({ fullName: 'Kiran Patel' });
    expect(await updatePatient(desk, id, edit())).toEqual({ ok: true, changed: [] });
  });

  it('warns about a duplicate when the mobile changes, and saves after acknowledgement', async () => {
    const desk = f.ctx('desk');
    await patient(desk, 'Lata Shah', '9311111111');
    const id = await patient(desk, 'Mohan Rao', '9322222222');
    const warned = await updatePatient(desk, id, edit({ fullName: 'Mohan Rao', phone: '+91 93111 11111' }));
    expect(warned).toMatchObject({ ok: false, duplicates: [expect.objectContaining({ fullName: 'Lata Shah' })] });
    expect(await updatePatient(desk, id, edit({ fullName: 'Mohan Rao', phone: '9311111111', ack: true }))).toMatchObject({ ok: true, changed: ['phone'] });
  });

  it('re-records the age with today’s date', async () => {
    const desk = f.ctx('desk');
    const id = await patient(desk);
    await updatePatient(desk, id, edit({ fullName: 'Kiran Patel', phone: '9300000009', age: 41, ack: true }));
    const [p] = await getDb().select().from(patients).where(eq(patients.id, id));
    expect([p!.approximateAge, p!.ageRecordedOn]).toEqual([41, businessDate()]);
  });

  it('refuses roles without patient.edit and other organisations', async () => {
    const id = await patient(f.ctx('desk'));
    await expect(updatePatient(f.ctx('accountant'), id, edit())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updatePatient(other.ctx('owner', other.pune.id), id, edit())).rejects.toBeInstanceOf(ForbiddenError);
    expect(await updatePatient(f.ctx('desk'), id, { ...edit(), phone: '12345' })).toMatchObject({ ok: false, fieldErrors: { phone: expect.any(String) } });
  });
});

describe('Reset password link (T39)', () => {
  it('lets the owner reset a forgotten password: old one works until used, then sessions end', async () => {
    const owner = f.ctx('owner');
    const deskId = f.ctx('desk').userId;
    const before = await signInWithPassword(f.emails.desk, f.password);
    expect(before.ok).toBe(true);
    const { token } = await passwordResetLink(owner, deskId);
    expect((await signInWithPassword(f.emails.desk, f.password)).ok).toBe(true); // not locked out by the link
    const r = await redeemInvite(token, 'a brand new desk password', 'a brand new desk password');
    expect(r.ok).toBe(true);
    expect((await signInWithPassword(f.emails.desk, f.password)).ok).toBe(false);
    const left = await getDb().select().from(sessions).where(eq(sessions.userId, deskId));
    expect(left).toHaveLength(1); // only the one the reset just created
    const audits = await getDb().select().from(auditLog).where(and(eq(auditLog.entityId, deskId), eq(auditLog.action, 'staff.password_reset_link')));
    expect(audits).toHaveLength(1);
  });

  it('refuses a manager, yourself, someone without a password, and another clinic', async () => {
    await expect(passwordResetLink(f.ctx('manager'), f.ctx('desk').userId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(passwordResetLink(f.ctx('owner'), f.ctx('owner').userId)).rejects.toBeInstanceOf(UserFacingError);
    await getDb().update(users).set({ passwordHash: null }).where(eq(users.id, f.ctx('accountant').userId));
    await expect(passwordResetLink(f.ctx('owner'), f.ctx('accountant').userId)).rejects.toThrow(/New link/);
    await expect(passwordResetLink(other.ctx('owner'), f.ctx('desk').userId)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('Export my data (T40)', () => {
  it('gives the owner every bill as CSV, money from paise, and audits the count only', async () => {
    const desk = f.ctx('desk');
    const pid = await patient(desk, '=Evil Formula', '9344444444');
    const r = await issueBill(desk, { patientId: pid, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.rct, quantity: 1 }] });
    if (r.kind !== 'issued') throw new Error('not issued');
    const out = await exportCsv(f.ctx('owner'), 'bills');
    expect(out.csv.startsWith('﻿Bill number,Date,Branch')).toBe(true);
    const line = out.csv.split('\r\n').find((l) => l.includes("'=Evil Formula"));
    expect(line).toContain(',4500.00,0.00,4500.00,'); // total, paid, due for a ₹4,500 root canal
    const pts = await exportCsv(f.ctx('owner'), 'patients');
    expect(pts.csv).toContain("'=Evil Formula");
    expect(pts.csv).not.toContain(other.pune.code);
    const [a] = await getDb().select().from(auditLog).where(and(eq(auditLog.orgId, f.orgId), eq(auditLog.action, 'data.export')));
    expect(a!.after).toEqual({ kind: 'bills', rows: out.rows });
  });

  it('is owner-only', async () => {
    await expect(exportCsv(f.ctx('manager'), 'patients')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(exportCsv(f.ctx('accountant'), 'payments')).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('Waiting room (T36)', () => {
  it('hands out tokens 1, 2, 3 per branch per day and refuses a second active visit', async () => {
    const o = other.ctx('owner', other.pune.id);
    const a = await patient(o, 'Asha One');
    const b = await patient(o, 'Bina Two');
    expect((await addToQueue(o, a)).token).toBe(1);
    expect((await addToQueue(o, b)).token).toBe(2);
    await expect(addToQueue(o, a)).rejects.toThrow(/token 1/);
    const k = other.ctx('owner', other.kanpur.id);
    expect((await addToQueue(k, a)).token).toBe(1); // Kanpur counts its own tokens
  });

  it('moves forward, undoes a seat, freezes finished visits and past days', async () => {
    const o = other.ctx('owner', other.pune.id);
    const pid = await patient(o, 'Chetan Three');
    const { visitId } = await addToQueue(o, pid);
    await moveVisit(o, visitId, 'in_chair');
    await moveVisit(o, visitId, 'waiting');
    await moveVisit(o, visitId, 'in_chair');
    await moveVisit(o, visitId, 'done');
    await expect(moveVisit(o, visitId, 'waiting')).rejects.toThrow(/already finished/);
    const again = await addToQueue(o, pid); // a second visit the same day after the first finished
    await getDb().update(visits).set({ businessDate: addDays(businessDate(), -1) }).where(eq(visits.id, again.visitId));
    await expect(moveVisit(o, again.visitId, 'in_chair')).rejects.toThrow(/Only today/);
    const audits = await getDb().select().from(auditLog).where(and(eq(auditLog.entityId, visitId), eq(auditLog.action, 'visit.move')));
    expect(audits).toHaveLength(4);
  });

  it('flags "seen, not billed" until a bill is issued that day', async () => {
    const desk = f.ctx('desk');
    const pid = await patient(desk, 'Deepa Four');
    const { visitId } = await addToQueue(desk, pid);
    await moveVisit(desk, visitId, 'done');
    const flagged = (await queueFor(desk, [f.pune.id])).find((v) => v.id === visitId)!;
    expect(flagged.seenNotBilled).toBe(true);
    await issueBill(desk, { patientId: pid, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.rct, quantity: 1 }] });
    expect((await queueFor(desk, [f.pune.id])).find((v) => v.id === visitId)!.seenNotBilled).toBe(false);
  });

  it('refuses roles without visit.manage, other branches and other clinics', async () => {
    const pid = await patient(f.ctx('desk'), 'Esha Five');
    await expect(addToQueue(f.ctx('accountant', f.pune.id), pid)).rejects.toBeInstanceOf(ForbiddenError);
    const { visitId } = await addToQueue(f.ctx('desk'), pid);
    await expect(moveVisit(f.ctx('kanpurDesk'), visitId, 'in_chair')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(moveVisit(other.ctx('owner', other.pune.id), visitId, 'in_chair')).rejects.toBeInstanceOf(ForbiddenError);
    expect(await queueFor(other.ctx('owner', 'all'), [f.pune.id])).toEqual([]);
  });
});

describe('Recalls (T37)', () => {
  it('keeps one open recall per patient per branch, lists it, reminds without naming treatment, and closes', async () => {
    const desk = f.ctx('desk');
    const pid = await patient(desk, 'Farah Six', '9355555555');
    const today = businessDate();
    await setRecall(desk, pid, 'continue', addDays(today, 3));
    const { recallId } = await setRecall(desk, pid, 'checkup', addDays(today, 2));
    const open = await getDb().select().from(recalls).where(and(eq(recalls.patientId, pid), eq(recalls.status, 'open')));
    expect(open.map((r) => r.id)).toEqual([recallId]);

    const listed = (await openRecalls(desk, { branchIds: [f.pune.id], horizonDays: 7, today })).find((r) => r.id === recallId)!;
    expect(listed.bucket).toBe('this_week');
    expect(listed.href).toMatch(/^https:\/\/wa\.me\/919355555555\?text=/);
    const text = decodeURIComponent(listed.href!.split('text=')[1]!);
    expect(text).toContain('Namaste Farah,');
    expect(text).not.toMatch(/check-up|root|crown|Six/i);

    await logRecallReminder(desk, recallId);
    await logRecallReminder(desk, recallId);
    const [r] = await getDb().select().from(recalls).where(eq(recalls.id, recallId));
    expect(r!.remindCount).toBe(2);
    await closeRecall(desk, recallId, 'done');
    await expect(logRecallReminder(desk, recallId)).rejects.toBeInstanceOf(UserFacingError);
    expect((await openRecalls(desk, { branchIds: [f.pune.id], patientId: pid })).length).toBe(0);
  });

  it('checks the date and kind, and refuses roles and clinics without access', async () => {
    const desk = f.ctx('desk');
    const pid = await patient(desk);
    const today = businessDate();
    await expect(setRecall(desk, pid, 'root_canal', today)).rejects.toThrow(/what the next visit is for/);
    await expect(setRecall(desk, pid, 'checkup', addDays(today, -1))).rejects.toThrow(/today or a later/);
    await expect(setRecall(desk, pid, 'checkup', addDays(today, 1200))).rejects.toThrow(/3 years/);
    await expect(setRecall(desk, pid, 'checkup', '2026-02-30')).rejects.toThrow(/Pick the date/);
    await expect(setRecall(f.ctx('accountant', f.pune.id), pid, 'checkup', today)).rejects.toBeInstanceOf(ForbiddenError);
    const { recallId } = await setRecall(desk, pid, 'review', today);
    await expect(closeRecall(other.ctx('owner'), recallId, 'done')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(logRecallReminder(f.ctx('kanpurDesk'), recallId)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
