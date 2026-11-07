import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { addDays, businessDate } from '@/domain/dates';
import { createFixture, key, type Fixture } from '@/test/fixtures';
import { ForbiddenError } from './context';
import { issueBill, voidInvoice } from './invoices';
import { registerPatient } from './patients';
import { addStarterMedicines, listMedicines } from './rx';
import { listStock, recordMovement, saveStockItem, stockHistory } from './stock';

let f: Fixture;
let other: Fixture;
const mv = (kind: string, quantity: string, extra: Partial<{ direction: 'in' | 'out'; expiresOn: string; unitCost: string; reason: string }> = {}) => ({ kind, quantity, direction: 'in' as const, expiresOn: '', unitCost: '', reason: '', ...extra });

beforeAll(async () => {
  f = await createFixture();
  other = await createFixture();
});
afterAll(async () => {
  await closeDb();
});

describe('stock-lite (LET-176)', () => {
  let gloves: string;
  let brush: string;
  let chx: string;

  it('adds a clinic supply and a medicine; received, used and adjusted add up per branch', async () => {
    const g = await saveStockItem(f.ctx('desk'), null, { kind: 'supply', name: 'Nitrile gloves (M)', unit: 'box', reorderLevel: '2', medicineId: '', catalogueItemId: '' });
    if (!g.ok) throw new Error(JSON.stringify(g));
    gloves = g.id;
    expect(await recordMovement(f.ctx('desk'), gloves, mv('received', '5', { unitCost: '450' }))).toEqual({ ok: true, onHand: 5 });
    expect(await recordMovement(f.ctx('desk'), gloves, mv('used', '2', { reason: 'Morning trays' }))).toEqual({ ok: true, onHand: 3 });
    expect(await recordMovement(f.ctx('desk'), gloves, mv('adjusted', '1', { direction: 'out', reason: 'Counted one short' }))).toEqual({ ok: true, onHand: 2 });
    expect((await recordMovement(f.ctx('desk'), gloves, mv('used', '1'))).ok).toBe(false); // needs a reason
    const row = (await listStock(f.ctx('desk'), f.pune.id)).find((r) => r.id === gloves)!;
    expect(row).toMatchObject({ onHand: 2, low: true, kind: 'supply' });
    // Kanpur has its own shelf.
    expect((await listStock(f.ctx('kanpurDesk'), f.kanpur.id)).find((r) => r.id === gloves)!.onHand).toBe(0);
    expect((await stockHistory(f.ctx('desk'), f.pune.id, gloves)).map((h) => h.kind)).toEqual(['adjusted', 'used', 'received']);

    await addStarterMedicines(f.ctx('owner'));
    const med = (await listMedicines(f.ctx('owner'))).find((m) => m.name === 'Chlorhexidine')!;
    const c = await saveStockItem(f.ctx('desk'), null, { kind: 'medicine', name: '', unit: 'bottle', reorderLevel: '3', medicineId: med.id, catalogueItemId: '' });
    if (!c.ok) throw new Error(JSON.stringify(c));
    chx = c.id;
    const soon = addDays(businessDate(), 30);
    await recordMovement(f.ctx('desk'), chx, mv('received', '6', { expiresOn: soon }));
    expect((await listStock(f.ctx('desk'), f.pune.id)).find((r) => r.id === chx)).toMatchObject({ name: 'Chlorhexidine 0.2%', onHand: 6, mayExpireOn: soon, expiring: true, low: false });
    expect((await saveStockItem(f.ctx('desk'), null, { kind: 'medicine', name: '', unit: 'bottle', reorderLevel: '0', medicineId: med.id, catalogueItemId: '' })).ok).toBe(false);
  });

  it('a toothbrush sold on a bill leaves stock with the bill, and comes back if the bill is cancelled as not handed over', async () => {
    const b = await saveStockItem(f.ctx('desk'), null, { kind: 'supply', name: 'Toothbrush (soft)', unit: 'piece', reorderLevel: '5', medicineId: '', catalogueItemId: f.items.brush });
    if (!b.ok) throw new Error(JSON.stringify(b));
    brush = b.id;
    await recordMovement(f.ctx('desk'), brush, mv('received', '20'));
    const r = await registerPatient(f.ctx('desk'), { fullName: 'Stock Buyer', phone: `91${Math.floor(10_000_000 + Math.random() * 89_999_999)}`, sex: 'M', age: 30, acknowledgedDuplicate: true });
    if (!r.ok) throw new Error('reg');
    const bill = await issueBill(f.ctx('desk'), { patientId: r.patientId, doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: f.items.brush, quantity: 3 }] });
    if (bill.kind !== 'issued') throw new Error('not issued');
    expect((await listStock(f.ctx('desk'), f.pune.id)).find((x) => x.id === brush)!.onHand).toBe(17);
    await voidInvoice(f.ctx('owner', f.pune.id), bill.invoiceId, 'Patient changed mind', false);
    expect((await listStock(f.ctx('desk'), f.pune.id)).find((x) => x.id === brush)!.onHand).toBe(20);
    // A service (exempt treatment) can't be sold from stock.
    expect(await saveStockItem(f.ctx('desk'), null, { kind: 'supply', name: 'Not stock', unit: 'piece', reorderLevel: '0', medicineId: '', catalogueItemId: f.items.rct })).toMatchObject({ ok: false, fieldErrors: { catalogueItemId: expect.any(String) } });
  });

  it('accountants can look, not change; other orgs can do neither', async () => {
    expect((await listStock(f.ctx('accountant', f.pune.id), f.pune.id)).length).toBeGreaterThan(0);
    await expect(recordMovement(f.ctx('accountant', f.pune.id), gloves, mv('received', '1'))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listStock(other.ctx('owner', other.pune.id), f.pune.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordMovement(other.ctx('owner', other.pune.id), gloves, mv('received', '1'))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listStock(other.ctx('owner', other.pune.id), other.pune.id)).map((r) => r.id)).not.toContain(chx);
  });
});
