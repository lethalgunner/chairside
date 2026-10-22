import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { auditLog, catalogueItems } from '@/db/schema';
import type { CatalogueItemInput } from '@/domain/catalogue';
import { createFixture, key, type Fixture } from '@/test/fixtures';
import { createCatalogueItem, listCatalogue, listCatalogueForSettings, setCatalogueItemActive, updateCatalogueItem } from './catalogue';
import { ForbiddenError, UserFacingError } from './context';
import { getInvoice, issueBill } from './invoices';
import { registerPatient } from './patients';

let f: Fixture;
let other: Fixture;

const guard: CatalogueItemInput = { code: 'NGD', name: 'Night guard', category: 'Prosthodontics', price: '2500', taxCategory: 'goods_prosthetic', hsnSacCode: '9021', gstRateBp: 500 };

async function patient(): Promise<string> {
  const phone = `97${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const r = await registerPatient(f.ctx('desk'), { fullName: `Patient ${phone}`, phone, sex: 'M', age: 50, acknowledgedDuplicate: true });
  if (!r.ok) throw new Error('registration failed');
  return r.patientId;
}

async function billFor(itemId: string) {
  const res = await issueBill(f.ctx('desk'), { patientId: await patient(), doctorId: f.doctorId, idempotencyKey: key(), mode: 'issue', lines: [{ catalogueItemId: itemId, quantity: 1 }] });
  if (res.kind !== 'issued') throw new Error('not issued');
  return (await getInvoice(f.ctx('desk'), res.invoiceId))!;
}

beforeAll(async () => {
  f = await createFixture();
  other = await createFixture();
});
afterAll(async () => {
  await closeDb();
});

describe('price list settings (T15)', () => {
  let id: string;

  it('adds an item the bill builder offers at once', async () => {
    const r = await createCatalogueItem(f.ctx('owner'), guard);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    id = r.id;
    const offered = (await listCatalogue(f.ctx('desk'), f.pune.id)).find((c) => c.id === id);
    expect(offered).toMatchObject({ code: 'NGD', pricePaise: 250_000, gstRateBp: 500, taxCategory: 'goods_prosthetic' });
    const [row] = await getDb().select().from(catalogueItems).where(eq(catalogueItems.id, id));
    expect(row!.isGoods).toBe(true);
  });

  it('a price or rate change leaves issued bills exactly as issued', async () => {
    // Pune is GST-registered: 2,500.00 + 5 % = 2,625.00.
    const before = await billFor(id);
    expect(before.lines[0]).toMatchObject({ unitPricePaise: 250_000, gstRateBp: 500, cgstPaise: 6_250, sgstPaise: 6_250, lineTotalPaise: 262_500 });
    expect(before.totals.totalPaise).toBe(262_500);

    const r = await updateCatalogueItem(f.ctx('owner'), id, { ...guard, price: '3000', gstRateBp: 1800 });
    expect(r.ok).toBe(true);

    const reread = await getInvoice(f.ctx('desk'), before.id);
    expect(reread!.lines).toEqual(before.lines);
    expect(reread!.totals).toEqual(before.totals);

    // The next bill uses the new figures: 3,000.00 + 18 % = 3,540.00.
    const after = await billFor(id);
    expect(after.lines[0]).toMatchObject({ unitPricePaise: 300_000, gstRateBp: 1800, lineTotalPaise: 354_000 });
  });

  it('keeps the code fixed and unique per org', async () => {
    await updateCatalogueItem(f.ctx('owner'), id, { ...guard, code: 'CHANGED', price: '3000', gstRateBp: 1800 });
    const [row] = await getDb().select().from(catalogueItems).where(eq(catalogueItems.id, id));
    expect(row!.code).toBe('NGD');
    expect(await createCatalogueItem(f.ctx('owner'), { ...guard, code: 'ngd' })).toMatchObject({ ok: false, fieldErrors: { code: expect.stringMatching(/already used/) } });
    // Another org may use the same code.
    expect((await createCatalogueItem(other.ctx('owner'), guard)).ok).toBe(true);
  });

  it('a deactivated item leaves the bill builder and cannot be billed, and can come back', async () => {
    // Owner only since T24 (the list is org-wide).
    await expect(setCatalogueItemActive(f.ctx('manager'), id, false)).rejects.toThrow(ForbiddenError);
    await setCatalogueItemActive(f.ctx('owner'), id, false);
    expect((await listCatalogue(f.ctx('desk'), f.pune.id)).map((c) => c.id)).not.toContain(id);
    await expect(billFor(id)).rejects.toThrow(UserFacingError);
    expect((await listCatalogueForSettings(f.ctx('owner'))).find((c) => c.id === id)?.active).toBe(false);
    await setCatalogueItemActive(f.ctx('owner'), id, true);
    expect((await listCatalogue(f.ctx('desk'), f.pune.id)).map((c) => c.id)).toContain(id);
  });

  it('forces exempt healthcare to 0 % on save', async () => {
    const r = await createCatalogueItem(f.ctx('owner'), { ...guard, code: 'EXT', name: 'Extraction', taxCategory: 'exempt_healthcare', hsnSacCode: '9993', gstRateBp: 1800 });
    if (!r.ok) throw new Error('not saved');
    const [row] = await getDb().select().from(catalogueItems).where(eq(catalogueItems.id, r.id));
    expect(row).toMatchObject({ gstRateBp: 0, isGoods: false });
  });

  it('audits every change', async () => {
    const actions = (await getDb().select().from(auditLog).where(eq(auditLog.entityId, id))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['catalogue.create', 'catalogue.update', 'catalogue.deactivate', 'catalogue.reactivate']));
  });

  it('is refused to the front desk and to another org', async () => {
    await expect(createCatalogueItem(f.ctx('desk'), { ...guard, code: 'DSK' })).rejects.toThrow(ForbiddenError);
    await expect(listCatalogueForSettings(f.ctx('accountant'))).rejects.toThrow(ForbiddenError);
    await expect(updateCatalogueItem(other.ctx('owner'), id, guard)).rejects.toThrow(ForbiddenError);
    await expect(setCatalogueItemActive(other.ctx('owner'), id, false)).rejects.toThrow(ForbiddenError);
  });
});
