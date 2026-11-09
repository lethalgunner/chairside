import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { createFixture, key, type Fixture } from '@/test/fixtures';
import { issueBill, listInvoices } from './invoices';
import { getDiscountCaps, myDiscountCapBp, saveDiscountCaps } from './discounts';
import { ForbiddenError } from './context';
import { registerPatient } from './patients';
import { recordReceipt } from './receipts';
import { duesFor } from './reports';
import { createCatalogueItem, listCatalogue, listCatalogueForSettings, updateCatalogueItem } from './catalogue';

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

describe('per-treatment length and come-back (Sprint 8)', () => {
  const base = { code: 'SCL8', name: 'Scaling deluxe', category: 'Perio', price: '1500', taxCategory: 'exempt_healthcare', hsnSacCode: '9993', gstRateBp: 0 };
  it('saved with the item, shown in the lists, kept when an edit (or paste) does not send them', async () => {
    const res = await createCatalogueItem(f.ctx('owner'), base, { minutes: '45', recallDays: '182', recallKind: 'cleaning' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const listed = (await listCatalogue(f.ctx('desk'), f.pune.id)).find((c) => c.id === res.id)!;
    expect(listed).toMatchObject({ defaultMinutes: 45, recallDays: 182, recallKind: 'cleaning' });
    await updateCatalogueItem(f.ctx('owner'), res.id, { ...base, price: '1600' });
    const after = (await listCatalogueForSettings(f.ctx('owner'))).find((c) => c.id === res.id)!;
    expect(after).toMatchObject({ pricePaise: 160_000, defaultMinutes: 45, recallDays: 182, recallKind: 'cleaning' });
    await updateCatalogueItem(f.ctx('owner'), res.id, base, { minutes: '', recallDays: '', recallKind: 'checkup' });
    const cleared = (await listCatalogueForSettings(f.ctx('owner'))).find((c) => c.id === res.id)!;
    expect(cleared).toMatchObject({ defaultMinutes: null, recallDays: null, recallKind: null });
  });
  it('bad values come back on their fields and nothing is saved', async () => {
    const res = await createCatalogueItem(f.ctx('owner'), { ...base, code: 'SCL9' }, { minutes: '7', recallDays: '30', recallKind: 'nope' });
    expect(res.ok ? [] : Object.keys(res.fieldErrors).sort()).toEqual(['minutes', 'recallKind']);
    expect((await listCatalogueForSettings(f.ctx('owner'))).some((c) => c.code === 'SCL9')).toBe(false);
  });
});

describe('discount limits per role (Sprint 8)', () => {
  // Fixture RCT is ₹4,500 (exempt). By hand: 10% of ₹4,500 = ₹450.
  const bill = (who: 'desk' | 'owner' | 'manager', discountPaise: number, pid: string) =>
    issueBill(f.ctx(who), { patientId: pid, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.rct, quantity: 1, discountPaise, discountReason: 'Senior citizen' }] });

  it('with no limits set (every clinic today) the desk can discount as before', async () => {
    expect(await getDiscountCaps(f.ctx('owner'))).toEqual({});
    expect(await myDiscountCapBp(f.ctx('desk'), f.pune.id)).toBeNull();
    expect((await bill('desk', 200_000, await patient())).kind).toBe('issued');
  });

  it('the owner sets 10% for the desk: ₹450 passes, ₹450.01 is refused and nothing is numbered', async () => {
    expect(await saveDiscountCaps(f.ctx('owner'), { front_desk: '10', branch_manager: '' })).toEqual({ ok: true });
    expect(await getDiscountCaps(f.ctx('owner'))).toEqual({ front_desk: 1000 });
    expect(await myDiscountCapBp(f.ctx('desk'), f.pune.id)).toBe(1000);
    expect((await bill('desk', 45_000, await patient())).kind).toBe('issued');
    const pid = await patient();
    await expect(bill('desk', 45_001, pid)).rejects.toThrow(/your limit is 10%/);
    expect(await listInvoices(f.ctx('desk'), { branchIds: [f.pune.id], patientId: pid })).toEqual([]);
    // The owner and an uncapped manager are unaffected.
    expect((await bill('owner', 300_000, pid)).kind).toBe('issued');
    expect((await bill('manager', 300_000, await patient())).kind).toBe('issued');
  });

  it('only the owner can see or change limits; bad values come back per role; other clinics are untouched', async () => {
    await expect(saveDiscountCaps(f.ctx('desk'), { front_desk: '100' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getDiscountCaps(f.ctx('manager'))).rejects.toBeInstanceOf(ForbiddenError);
    const bad = await saveDiscountCaps(f.ctx('owner'), { front_desk: '150' });
    expect(bad.ok ? [] : Object.keys(bad.fieldErrors)).toEqual(['front_desk']);
    expect(await getDiscountCaps(f.ctx('owner'))).toEqual({ front_desk: 1000 });
    expect(await myDiscountCapBp(other.ctx('desk'), other.pune.id)).toBeNull();
  });

  it('clearing the limit restores the old behaviour', async () => {
    await saveDiscountCaps(f.ctx('owner'), { front_desk: '' });
    expect((await bill('desk', 300_000, await patient())).kind).toBe('issued');
  });
});
