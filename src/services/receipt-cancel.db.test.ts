import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { auditLog, ledgerEntries } from '@/db/schema';
import { businessDate } from '@/domain/dates';
import { createFixture, key, type Fixture } from '@/test/fixtures';
import { ForbiddenError, UserFacingError } from './context';
import { closeDay, getDaySummary, reopenDay } from './daybook';
import { getInvoice, issueBill, listInvoices, voidInvoice } from './invoices';
import { registerPatient } from './patients';
import { cancelReceipt, getReceipt, recordReceipt } from './receipts';
import { dashboard, patientAccount } from './reports';

let f: Fixture;
const today = businessDate();

async function patient(ctxWho: 'desk' | 'owner' = 'desk') {
  const phone = `95${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const r = await registerPatient(f.ctx(ctxWho), { fullName: `Patient ${phone}`, phone, sex: 'F', age: 30, acknowledgedDuplicate: true });
  if (!r.ok) throw new Error('registration failed');
  return r.patientId;
}

beforeAll(async () => {
  f = await createFixture();
});
afterAll(async () => {
  await closeDb();
});

describe('cancel a payment (T19, Q7)', () => {
  it('cancelling one of two split payments puts every derived figure right', async () => {
    const desk = f.ctx('desk');
    const owner = f.ctx('owner', f.pune.id);
    const before = await getDaySummary(desk, f.pune.id, today);
    const dashBefore = (await dashboard(owner, [f.pune.id]))[0]!;

    // Root canal, exempt: ₹4,500.00. Paid ₹1,000 cash (the typo) + ₹3,500 UPI.
    const patientId = await patient();
    const bill = await issueBill(desk, { patientId, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.rct, quantity: 1 }] });
    if (bill.kind !== 'issued') throw new Error('not issued');
    const cash = await recordReceipt(desk, { patientId, amountPaise: 100_000, mode: 'cash', idempotencyKey: key() });
    await recordReceipt(desk, { patientId, amountPaise: 350_000, mode: 'upi', idempotencyKey: key() });
    expect((await getInvoice(desk, bill.invoiceId))!.duePaise).toBe(0);

    await cancelReceipt(owner, cash.receiptId, 'Cash was never taken');

    // Bill: ₹4,500 − ₹3,500 live = ₹1,000 due again.
    const inv = (await getInvoice(desk, bill.invoiceId))!;
    expect(inv.paidPaise).toBe(350_000);
    expect(inv.duePaise).toBe(100_000);
    expect(inv.payments.find((p) => p.receiptId === cash.receiptId)?.cancelReason).toBe('Cash was never taken');
    expect((await listInvoices(desk, { branchIds: [f.pune.id], patientId }))[0]!.duePaise).toBe(100_000);
    expect((await listInvoices(desk, { branchIds: [f.pune.id], openOnly: true })).map((r) => r.id)).toContain(bill.invoiceId);

    // Patient: +4,500 − 1,000 − 3,500 + 1,000 (reversal) = owes ₹1,000.
    const acct = await patientAccount(desk, patientId);
    expect(acct.balancePaise).toBe(100_000);
    expect(acct.statement.map((e) => e.entryType)).toEqual(['invoice', 'receipt', 'receipt', 'receipt_cancel']);

    // Day: cash unchanged, UPI +3,500, expected drawer unchanged.
    const after = await getDaySummary(desk, f.pune.id, today);
    expect(after.byMode.cash - before.byMode.cash).toBe(0);
    expect(after.byMode.upi - before.byMode.upi).toBe(350_000);
    expect(after.totalCollectedPaise - before.totalCollectedPaise).toBe(350_000);
    expect(after.expectedCashPaise - before.expectedCashPaise).toBe(0);

    // Dashboard: collected +3,500, patients owe +1,000.
    const dashAfter = (await dashboard(owner, [f.pune.id]))[0]!;
    expect(dashAfter.collectedPaise - dashBefore.collectedPaise).toBe(350_000);
    expect(dashAfter.outstandingPaise - dashBefore.outstandingPaise).toBe(100_000);

    // A new payment settles the reopened ₹1,000, not more.
    const again = await recordReceipt(desk, { patientId, amountPaise: 100_000, mode: 'upi', idempotencyKey: key() });
    expect(again.allocations).toEqual([{ invoiceId: bill.invoiceId, amountPaise: 100_000 }]);
    expect((await patientAccount(desk, patientId)).balancePaise).toBe(0);
  });

  it('a cancelled advance is not spent on the next bill', async () => {
    const desk = f.ctx('desk');
    const patientId = await patient();
    const adv = await recordReceipt(desk, { patientId, amountPaise: 50_000, mode: 'cash', idempotencyKey: key() });
    expect(adv.advancePaise).toBe(50_000);
    await cancelReceipt(f.ctx('owner', f.pune.id), adv.receiptId, 'Wrong patient');
    const bill = await issueBill(desk, { patientId, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.rct, quantity: 1 }] });
    if (bill.kind !== 'issued') throw new Error('not issued');
    expect((await getInvoice(desk, bill.invoiceId))!.duePaise).toBe(450_000);
    expect((await patientAccount(desk, patientId)).balancePaise).toBe(450_000);
    expect((await getReceipt(desk, adv.receiptId))?.cancelledAt).not.toBeNull();
  });

  it('a paid bill can be cancelled once its payments are', async () => {
    const desk = f.ctx('desk');
    const owner = f.ctx('owner', f.pune.id);
    const patientId = await patient();
    const bill = await issueBill(desk, { patientId, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.rct, quantity: 1 }] });
    if (bill.kind !== 'issued') throw new Error('not issued');
    const pay = await recordReceipt(desk, { patientId, amountPaise: 450_000, mode: 'card', idempotencyKey: key() });
    await expect(voidInvoice(owner, bill.invoiceId, 'Wrong patient billed')).rejects.toThrow(/Cancel them first/);
    await cancelReceipt(owner, pay.receiptId, 'Wrong patient billed');
    await voidInvoice(owner, bill.invoiceId, 'Wrong patient billed');
    expect((await patientAccount(desk, patientId)).balancePaise).toBe(0);
  });

  it('refuses twice, without a reason, for the front desk, and for another org', async () => {
    const desk = f.ctx('desk');
    const owner = f.ctx('owner', f.pune.id);
    const patientId = await patient();
    const r = await recordReceipt(desk, { patientId, amountPaise: 20_000, mode: 'cash', idempotencyKey: key() });
    await expect(cancelReceipt(desk, r.receiptId, 'Desk wants to undo')).rejects.toThrow(ForbiddenError);
    await expect(cancelReceipt(f.ctx('manager'), r.receiptId, 'Manager wants to undo')).rejects.toThrow(ForbiddenError);
    await expect(cancelReceipt(owner, r.receiptId, 'no')).rejects.toThrow(/Say why/);
    await cancelReceipt(owner, r.receiptId, 'Entered twice');
    await expect(cancelReceipt(owner, r.receiptId, 'Entered twice again')).rejects.toThrow(/already cancelled/);
    const other = await createFixture();
    await expect(cancelReceipt(other.ctx('owner'), r.receiptId, 'Not mine at all')).rejects.toThrow(ForbiddenError);
    const reversals = await getDb().select().from(ledgerEntries).where(eq(ledgerEntries.receiptId, r.receiptId));
    expect(reversals.map((e) => [e.entryType, e.amountPaise])).toEqual([
      ['receipt', -20_000],
      ['receipt_cancel', 20_000],
    ]);
    const audits = await getDb().select().from(auditLog).where(eq(auditLog.entityId, r.receiptId));
    expect(audits.map((a) => a.action)).toContain('receipt.cancel');
  });

  it('refuses on a closed day until the owner reopens it', async () => {
    // Kanpur, so the Pune tests above keep an open day.
    const owner = f.ctx('owner', f.kanpur.id);
    const patientId = await patient('owner');
    const r = await recordReceipt(owner, { patientId, amountPaise: 30_000, mode: 'cash', idempotencyKey: key() });
    await closeDay(owner, { denominations: { '100': 3 } });
    await expect(cancelReceipt(owner, r.receiptId, 'Typed the wrong amount')).rejects.toThrow(/Reopen the day first/);
    await reopenDay(owner, { branchId: f.kanpur.id, date: today, reason: 'Fix a payment typo' });
    await cancelReceipt(owner, r.receiptId, 'Typed the wrong amount');
    const s = await getDaySummary(owner, f.kanpur.id, today);
    expect(s.byMode.cash).toBe(0);
  });
});

it('refuses a non-uuid id', async () => {
  await expect(cancelReceipt(f.ctx('owner'), 'x', 'reason here')).rejects.toThrow(ForbiddenError);
  await expect(cancelReceipt(f.ctx('owner'), '00000000-0000-0000-0000-000000000000', 'reason here')).rejects.toThrow(ForbiddenError);
  expect(UserFacingError).toBeDefined();
});
