import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { dayBooks, invoices, receipts } from '@/db/schema';
import { addDays, businessDate } from '@/domain/dates';
import { createFixture, key, type Fixture } from '@/test/fixtures';
import type { TenantContext } from './context';
import { ForbiddenError } from './context';
import { getDaySummary } from './daybook';
import { issueBill, listInvoices } from './invoices';
import { registerPatient } from './patients';
import { recordReceipt } from './receipts';
import { dashboard, dayTotals, unclosedEarlierDays } from './reports';

/**
 * Past days, read-only (Q19, T27). Bills and payments are raised today, then
 * moved to an earlier business date directly in the database, which is the
 * only way a test can put activity on another day.
 */
let f: Fixture;
const today = businessDate();
const d1 = addDays(today, -1);
const d2 = addDays(today, -2);
const d3 = addDays(today, -3);

async function patient(ctx: TenantContext): Promise<string> {
  const phone = `95${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const p = await registerPatient(ctx, { fullName: `Patient ${phone}`, phone, sex: 'F', age: 38, acknowledgedDuplicate: true });
  if (!p.ok) throw new Error('registration failed');
  return p.patientId;
}

async function billOn(ctx: TenantContext, patientId: string, item: string, date: string, doctorId = f.doctorId): Promise<string> {
  const r = await issueBill(ctx, { patientId, doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: item, quantity: 1 }] });
  if (r.kind !== 'issued') throw new Error('not issued');
  await getDb().update(invoices).set({ issuedOn: date }).where(eq(invoices.id, r.invoiceId));
  return r.invoiceId;
}

async function payOn(ctx: TenantContext, patientId: string, amountPaise: number, mode: 'cash' | 'upi', date: string): Promise<void> {
  const r = await recordReceipt(ctx, { patientId, amountPaise, mode, idempotencyKey: key() });
  await getDb().update(receipts).set({ receivedOn: date }).where(eq(receipts.id, r.receiptId));
}

beforeAll(async () => {
  f = await createFixture();
  const desk = f.ctx('desk');
  const pid = await patient(desk);
  // d2 at Pune: one RCT (₹4,500), paid ₹4,500 by UPI.
  await billOn(desk, pid, f.items.rct, d2);
  await payOn(desk, pid, 450_000, 'upi', d2);
  // d1 at Pune: two crowns (₹6,720 each with 12 % GST), ₹1,000 cash.
  await billOn(desk, pid, f.items.crown, d1);
  await billOn(desk, pid, f.items.crown, d1);
  await payOn(desk, pid, 100_000, 'cash', d1);
  // d1 at Kanpur: one RCT, ₹500 cash.
  const kdesk = f.ctx('kanpurDesk');
  const kpid = await patient(kdesk);
  await billOn(kdesk, kpid, f.items.rct, d1, f.ownerId); // the owner also practises, at every branch
  await payOn(kdesk, kpid, 50_000, 'cash', d1);
  // The day books opened by those writes are today's; move them to the days
  // they stand for, then mark Pune's d2 closed as if closed that evening.
  await getDb().delete(dayBooks).where(inArray(dayBooks.branchId, [f.pune.id, f.kanpur.id]));
  await getDb().insert(dayBooks).values([
    { orgId: f.orgId, branchId: f.pune.id, businessDate: d2, status: 'closed', openingFloatPaise: 0, countedCashPaise: 0, variancePaise: 0, closedAt: new Date(), legacyBillCount: 2, legacyCollectedPaise: 450_000 },
    { orgId: f.orgId, branchId: f.pune.id, businessDate: d1, status: 'open', openingFloatPaise: 0 },
    { orgId: f.orgId, branchId: f.kanpur.id, businessDate: d1, status: 'open', openingFloatPaise: 0 },
  ]);
});
afterAll(async () => {
  await closeDb();
});

describe('a past day’s summary counts only that day (T27)', () => {
  it('day close for each date sees only its own bills and payments', async () => {
    const desk = f.ctx('desk');
    const s1 = await getDaySummary(desk, f.pune.id, d1);
    expect(s1).toMatchObject({ date: d1, status: 'open', billCount: 2, billedPaise: 1_344_000, totalCollectedPaise: 100_000, closed: null });
    expect(s1.byMode.cash).toBe(100_000);
    const s2 = await getDaySummary(desk, f.pune.id, d2);
    expect(s2).toMatchObject({ date: d2, status: 'closed', billCount: 1, billedPaise: 450_000, totalCollectedPaise: 450_000 });
    expect(s2.closed).toMatchObject({ legacyBillCount: 2, legacyCollectedPaise: 450_000 });
    const s3 = await getDaySummary(desk, f.pune.id, d3);
    expect(s3).toMatchObject({ billCount: 0, billedPaise: 0, totalCollectedPaise: 0, status: 'open', closed: null });
    const now = await getDaySummary(desk, f.pune.id, today);
    expect(now.billCount).toBe(0);
  });

  it('the dashboard for a past date is per branch and per date', async () => {
    const rows = await dashboard(f.ctx('owner', 'all'), [f.pune.id, f.kanpur.id], d1);
    expect(rows.find((r) => r.branchId === f.pune.id)).toMatchObject({ billCount: 2, billedPaise: 1_344_000, collectedPaise: 100_000 });
    expect(rows.find((r) => r.branchId === f.kanpur.id)).toMatchObject({ billCount: 1, billedPaise: 450_000, collectedPaise: 50_000 });
  });

  it('the Bills day filter and subtotal match, and stay inside the user’s branches', async () => {
    const owner = f.ctx('owner', 'all');
    expect(await dayTotals(owner, [f.pune.id, f.kanpur.id], d1)).toEqual({ billCount: 3, billedPaise: 1_794_000, byMode: { cash: 150_000 }, collectedPaise: 150_000 });
    expect(await dayTotals(owner, [f.pune.id], d2)).toEqual({ billCount: 1, billedPaise: 450_000, byMode: { upi: 450_000 }, collectedPaise: 450_000 });
    expect((await listInvoices(owner, { branchIds: [f.pune.id, f.kanpur.id], issuedOn: d1 })).length).toBe(3);
    expect((await listInvoices(owner, { branchIds: [f.pune.id], issuedOn: d2 })).length).toBe(1);
    // The Pune desk asking for both branches gets Pune only.
    const desk = f.ctx('desk');
    expect(await dayTotals(desk, [f.pune.id, f.kanpur.id], d1)).toMatchObject({ billCount: 2, collectedPaise: 100_000 });
    expect((await listInvoices(desk, { branchIds: [f.pune.id, f.kanpur.id], issuedOn: d1 })).length).toBe(2);
    // No branch figures at all: no subtotal.
    expect(await dayTotals(desk, [f.kanpur.id], d1)).toBeNull();
  });

  it('a branch outside the user’s grants is refused', async () => {
    await expect(getDaySummary(f.ctx('kanpurDesk'), f.pune.id, d1)).rejects.toThrow(ForbiddenError);
    expect(await dashboard(f.ctx('kanpurDesk'), [f.pune.id], d1)).toEqual([]);
  });
});

describe('the morning notice for a day nobody closed (T27)', () => {
  it('flags each branch whose last active day is not closed, for owner and manager only', async () => {
    const owner = await unclosedEarlierDays(f.ctx('owner', 'all'), [f.pune.id, f.kanpur.id], today);
    expect(owner).toEqual([
      { branchId: f.kanpur.id, branchName: 'Kanpur', date: d1 },
      { branchId: f.pune.id, branchName: 'Pune', date: d1 },
    ]);
    expect(await unclosedEarlierDays(f.ctx('manager'), [f.pune.id, f.kanpur.id], today)).toEqual([{ branchId: f.pune.id, branchName: 'Pune', date: d1 }]);
    expect(await unclosedEarlierDays(f.ctx('desk'), [f.pune.id], today)).toEqual([]);
    expect(await unclosedEarlierDays(f.ctx('accountant'), [f.pune.id], today)).toEqual([]);
  });

  it('skips a quiet day in between and stays quiet once the last active day was closed', async () => {
    // Seen from tomorrow: today had no activity, so d1 is still the day that matters.
    const tomorrow = addDays(today, 1);
    expect((await unclosedEarlierDays(f.ctx('owner', 'all'), [f.pune.id], tomorrow)).map((u) => u.date)).toEqual([d1]);
    // Seen from d1: the previous active day is d2, which was closed.
    expect(await unclosedEarlierDays(f.ctx('owner', 'all'), [f.pune.id], d1)).toEqual([]);
  });
});
