import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { businessDate } from '@/domain/dates';
import type { Paise } from '@/domain/money';
import { createFixture, key, type Fixture } from '@/test/fixtures';
import { closeDay } from './daybook';
import { issueBill } from './invoices';
import { registerPatient } from './patients';
import { cancelReceipt, recordReceipt } from './receipts';
import { parallelRun } from './reports';

let f: Fixture;
const today = businessDate();

beforeAll(async () => {
  f = await createFixture();
});
afterAll(async () => {
  await closeDb();
});

describe('parallel run report (T21)', () => {
  it('compares a closed day with the old system, counting only live payments', async () => {
    const desk = f.ctx('desk');
    const phone = `93${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const p = await registerPatient(desk, { fullName: `Patient ${phone}`, phone, sex: 'F', age: 61, acknowledgedDuplicate: true });
    if (!p.ok) throw new Error('registration failed');
    // Two bills: ₹4,500 (RCT, exempt) and ₹141.60 → ₹142 (toothbrush + 18 % at GST-registered Pune).
    for (const item of [f.items.rct, f.items.brush]) {
      const r = await issueBill(desk, { patientId: p.patientId, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: item, quantity: 1 }] });
      expect(r.kind).toBe('issued');
    }
    await recordReceipt(desk, { patientId: p.patientId, amountPaise: 400_000, mode: 'upi', idempotencyKey: key() });
    const typo = await recordReceipt(desk, { patientId: p.patientId, amountPaise: 500_000, mode: 'cash', idempotencyKey: key() });
    await cancelReceipt(f.ctx('owner', f.pune.id), typo.receiptId, 'Typed 5,000 for 500');
    await recordReceipt(desk, { patientId: p.patientId, amountPaise: 50_000, mode: 'cash', idempotencyKey: key() });
    // Old system: 3 bills, ₹5,000 collected. Chairside: 2 bills, ₹4,000 + ₹500 = ₹4,500.
    await closeDay(desk, { denominations: { '500': 1 }, legacyBillCount: 3, legacyCollectedPaise: 500_000 as Paise });

    const rows = await parallelRun(f.ctx('owner'), [f.pune.id, f.kanpur.id], today);
    const pune = rows.find((r) => r.branchId === f.pune.id && r.date === today)!;
    expect(pune.dayStatus).toBe('closed');
    expect(pune.comparison).toMatchObject({
      bills: { old: 3, chairside: 2, diff: -1 },
      collected: { old: 500_000, chairside: 450_000, diff: -50_000 },
      verdict: 'Chairside is ₹500 short: 1 bill may be missing',
    });
    expect(rows.find((r) => r.branchId === f.kanpur.id)).toBeUndefined(); // no activity at Kanpur
  });

  it('is only for people who can see branch reports', async () => {
    expect(await parallelRun(f.ctx('desk'), [f.pune.id], today)).toEqual([]);
    expect((await parallelRun(f.ctx('accountant'), [f.pune.id], today)).length).toBe(1);
  });
});
