import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { auditLog, branches, dayBooks, patients, paymentReminders, usageEvents } from '@/db/schema';
import { addDays, businessDate } from '@/domain/dates';
import { paise } from '@/domain/money';
import { createFixture, key, type Fixture } from '@/test/fixtures';
import { getBranch, updateBranchDetails } from './branches';
import { ForbiddenError, UserFacingError, type TenantContext } from './context';
import { getDaySummary } from './daybook';
import { issueBill } from './invoices';
import { registerPatient } from './patients';
import { recordReceipt } from './receipts';
import { logReminder, reminderKey, reminderTargets } from './reminders';
import { closeStreaks } from './streak';
import { recordDaySummaryOpen } from './usage';

/** Sprint 2: UPI details (T31), WhatsApp reminders (T32), day summary (T33), streak (T35). */
let f: Fixture;
let other: Fixture;

async function patient(ctx: TenantContext, phone = `97${Math.floor(10_000_000 + Math.random() * 89_999_999)}`): Promise<string> {
  const p = await registerPatient(ctx, { fullName: `Meena Rao ${phone.slice(-4)}`, phone, sex: 'F', age: 40, acknowledgedDuplicate: true });
  if (!p.ok) throw new Error('registration failed');
  return p.patientId;
}

/** A ₹4,500 root canal bill at the context's branch. */
async function bill(ctx: TenantContext, patientId: string): Promise<string> {
  const r = await issueBill(ctx, { patientId, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.rct, quantity: 1 }] });
  if (r.kind !== 'issued') throw new Error('not issued');
  return r.invoiceId;
}

const branchInput = (b: { name: string }, upiId: string, upiPayee: string) => ({
  name: b.name,
  addressLine: '',
  city: 'Pune',
  state: 'Maharashtra',
  phone: '020 1234 5678',
  gstRegistered: false,
  gstin: '',
  dayCloseTolerance: '100',
  defaultFloat: '2000',
  upiId,
  upiPayee,
});

beforeAll(async () => {
  f = await createFixture();
  other = await createFixture();
});
afterAll(async () => {
  await closeDb();
});

describe('Branch UPI details (T31)', () => {
  it('saves a valid UPI ID for the owner, audits before and after, and reads it back', async () => {
    const owner = f.ctx('owner', f.pune.id);
    const res = await updateBranchDetails(owner, f.pune.id, branchInput({ name: 'Pune' }, ' DemoDental@OKHDFCBANK ', 'Demo Dental Pune'));
    expect(res).toEqual({ ok: true });
    const b = await getBranch(owner, f.pune.id);
    expect([b.upiId, b.upiPayee]).toEqual(['demodental@okhdfcbank', 'Demo Dental Pune']);
    const [a] = await getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, f.pune.id), eq(auditLog.action, 'branch.update')));
    expect(a!.before).toMatchObject({ upiId: null, upiPayee: null });
    expect(a!.after).toMatchObject({ upiId: 'demodental@okhdfcbank', upiPayee: 'Demo Dental Pune' });
  });

  it('refuses a malformed ID with a field error and changes nothing', async () => {
    const owner = f.ctx('owner', f.pune.id);
    const res = await updateBranchDetails(owner, f.pune.id, branchInput({ name: 'Pune' }, 'demodental', 'Demo Dental Pune'));
    expect(res).toMatchObject({ ok: false, fieldErrors: { upiId: expect.stringContaining('looks like') } });
    expect((await getBranch(owner, f.pune.id)).upiId).toBe('demodental@okhdfcbank');
  });

  it('leaves UPI as it was when an older form sends no UPI fields', async () => {
    const owner = f.ctx('owner', f.pune.id);
    const { upiId: _u, upiPayee: _p, ...old } = branchInput({ name: 'Pune' }, '', '');
    expect(await updateBranchDetails(owner, f.pune.id, old)).toEqual({ ok: true });
    expect((await getBranch(owner, f.pune.id)).upiId).toBe('demodental@okhdfcbank');
  });

  it('is owner-only: a branch manager cannot set where patients pay', async () => {
    await expect(updateBranchDetails(f.ctx('manager'), f.pune.id, branchInput({ name: 'Pune' }, 'thief@ybl', 'Thief'))).rejects.toBeInstanceOf(ForbiddenError);
    const [row] = await getDb().select({ upiId: branches.upiId }).from(branches).where(eq(branches.id, f.pune.id));
    expect(row!.upiId).toBe('demodental@okhdfcbank');
  });
});

describe('WhatsApp dues reminders (T32)', () => {
  it('builds a wa.me link with the amount due at that branch, logs a reminder, and shows when', async () => {
    const desk = f.ctx('desk');
    const patientId = await patient(desk, '9822041155');
    await bill(desk, patientId);
    await recordReceipt(desk, { patientId, amountPaise: paise(50_000), mode: 'cash', idempotencyKey: key() });
    const due = paise(400_000);

    const targets = await reminderTargets(desk, [{ patientId, branchId: f.pune.id, amountPaise: due }]);
    const t = targets.get(reminderKey(patientId, f.pune.id))!;
    expect(t.href).toMatch(/^https:\/\/wa\.me\/919822041155\?text=/);
    const text = decodeURIComponent(t.href!.split('text=')[1]!);
    expect(text).toContain('₹4,000.00 is pending');
    expect(text).toContain('demodental@okhdfcbank');
    expect(text).not.toMatch(/root canal|Rao|Dr\./i);
    expect(t.lastSentAt).toBeNull();

    const logged = await logReminder(desk, patientId, f.pune.id);
    expect(logged.amountPaise).toBe(400_000);
    const again = (await reminderTargets(desk, [{ patientId, branchId: f.pune.id, amountPaise: due }])).get(reminderKey(patientId, f.pune.id))!;
    expect(again.lastSentAt?.getTime()).toBe(logged.sentAt.getTime());
  });

  it('works out the amount itself: refuses when nothing is due', async () => {
    const desk = f.ctx('desk');
    const patientId = await patient(desk);
    await expect(logReminder(desk, patientId, f.pune.id)).rejects.toBeInstanceOf(UserFacingError);
    const rows = await getDb().select().from(paymentReminders).where(eq(paymentReminders.patientId, patientId));
    expect(rows).toHaveLength(0);
  });

  it('refuses roles without patient.remind, other branches and other organisations', async () => {
    const desk = f.ctx('desk');
    const patientId = await patient(desk);
    await bill(desk, patientId);
    await expect(logReminder(f.ctx('accountant'), patientId, f.pune.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(logReminder(f.ctx('kanpurDesk'), patientId, f.pune.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(logReminder(other.ctx('owner', other.pune.id), patientId, other.pune.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(logReminder(desk, 'not-a-uuid', f.pune.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await reminderTargets(f.ctx('accountant'), [{ patientId, branchId: f.pune.id, amountPaise: paise(450_000) }])).toEqual(new Map());
  });

  it('gives no link, but still a target, when the patient has no Indian mobile', async () => {
    const desk = f.ctx('desk');
    const patientId = await patient(desk);
    await getDb().update(patients).set({ phone: '0201234567' }).where(eq(patients.id, patientId));
    const t = (await reminderTargets(desk, [{ patientId, branchId: f.pune.id, amountPaise: paise(100) }])).get(reminderKey(patientId, f.pune.id));
    expect(t?.href).toBeNull();
  });
});

describe('Day summary (T33) and close streak (T35)', () => {
  it('names who closed the day, and logs the summary open without data', async () => {
    const today = businessDate();
    const d = addDays(today, -1);
    await getDb()
      .insert(dayBooks)
      .values({ orgId: f.orgId, branchId: f.kanpur.id, businessDate: d, status: 'closed', countedCashPaise: 0, variancePaise: 0, closedAt: new Date(), closedBy: f.ctx('kanpurDesk').userId });
    const s = await getDaySummary(f.ctx('kanpurDesk'), f.kanpur.id, d);
    expect(s.closed?.closedByName).toBe('Desk Kanpur');

    await recordDaySummaryOpen(f.ctx('kanpurDesk'), f.kanpur.id);
    await recordDaySummaryOpen(f.ctx('kanpurDesk'), other.pune.id); // not theirs: ignored
    const ev = await getDb().select().from(usageEvents).where(and(eq(usageEvents.orgId, f.orgId), eq(usageEvents.kind, 'day_summary_open')));
    expect(ev).toHaveLength(1);
    expect(ev[0]!.branchId).toBe(f.kanpur.id);
  });

  it('counts closed days with activity, skips quiet days, stops at an unclosed active day', async () => {
    const o = other.ctx('owner', 'all');
    const today = businessDate();
    const d = (n: number) => addDays(today, -n);
    await getDb()
      .insert(dayBooks)
      .values([
        { orgId: other.orgId, branchId: other.pune.id, businessDate: d(1), status: 'closed' },
        { orgId: other.orgId, branchId: other.pune.id, businessDate: d(2), status: 'closed' },
        // d(3): no activity at all (a Sunday): skipped
        { orgId: other.orgId, branchId: other.pune.id, businessDate: d(4), status: 'closed' },
        { orgId: other.orgId, branchId: other.pune.id, businessDate: d(5), status: 'reopened' },
        { orgId: other.orgId, branchId: other.pune.id, businessDate: d(6), status: 'closed' },
      ]);
    const s = await closeStreaks(o, [other.pune.id, other.kanpur.id, f.pune.id], today);
    expect(s.get(other.pune.id)).toBe(3);
    expect(s.get(other.kanpur.id)).toBe(0);
    expect(s.has(f.pune.id)).toBe(false); // another organisation's branch is never read
  });
});

