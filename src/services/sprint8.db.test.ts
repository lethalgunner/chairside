import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { createFixture, key, type Fixture } from '@/test/fixtures';
import { issueBill } from './invoices';
import { registerPatient } from './patients';
import { recordReceipt } from './receipts';
import { duesFor } from './reports';

let f: Fixture;
let other: Fixture;
beforeAll(async () => {
  f = await createFixture();
  other = await createFixture();
});
afterAll(async () => {
  await closeDb();
});

async function patient(fx = f): Promise<string> {
  const r = await registerPatient(fx.ctx('desk'), { fullName: 'Due Patient', phone: `9${Math.floor(100_000_000 + Math.random() * 899_999_999)}`, sex: 'M', age: 50, acknowledgedDuplicate: true });
  if (!r.ok) throw new Error('registration failed');
  return r.patientId;
}

describe('"₹ due" badge (Sprint 8)', () => {
  it('sums open bills per patient, after payments, never across clinics', async () => {
    const owes = await patient();
    const paidUp = await patient();
    const none = await patient();
    // Fixture RCT is ₹4,500 (exempt); by hand: two bills = ₹9,000, minus ₹1,000 paid = ₹8,000.
    for (let i = 0; i < 2; i++) await issueBill(f.ctx('desk'), { patientId: owes, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.rct, quantity: 1 }] });
    await recordReceipt(f.ctx('desk'), { patientId: owes, mode: 'cash', amountPaise: 100_000, idempotencyKey: key() });
    await issueBill(f.ctx('desk'), { patientId: paidUp, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.rct, quantity: 1 }] });
    await recordReceipt(f.ctx('desk'), { patientId: paidUp, mode: 'upi', amountPaise: 450_000, idempotencyKey: key() });
    const dues = await duesFor(f.ctx('desk'), [f.pune.id], [owes, paidUp, none]);
    expect(dues.get(owes)).toBe(800_000);
    expect(dues.has(paidUp)).toBe(false);
    expect(dues.has(none)).toBe(false);
    expect((await duesFor(other.ctx('desk'), [other.pune.id], [owes])).size).toBe(0);
    expect((await duesFor(f.ctx('desk'), [f.pune.id], [])).size).toBe(0);
  });
});
