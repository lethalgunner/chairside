import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { auditLog, catalogueItems } from '@/db/schema';
import { createFixture, type Fixture } from '@/test/fixtures';
import { createCatalogueItem } from './catalogue';
import { IMPORT_CHANGED, IMPORT_HAS_ERRORS, previewCatalogueImport, saveCatalogueImport } from './catalogue-import';
import { ForbiddenError } from './context';

let f: Fixture;
let other: Fixture;

const tsv = (...rows: string[][]) => rows.map((r) => r.join('\t')).join('\n');
const HEADER = ['Code', 'Name', 'Category', 'Price (₹)', 'GST treatment', 'HSN/SAC', 'GST %'];

async function itemsByCode(orgId: string, codes: string[]) {
  const rows = await getDb()
    .select()
    .from(catalogueItems)
    .where(and(eq(catalogueItems.orgId, orgId), inArray(catalogueItems.code, codes)));
  return new Map(rows.map((r) => [r.code, r]));
}

async function previewPlan(text: string) {
  const p = await previewCatalogueImport(f.ctx('owner'), text);
  if (!p.ok) throw new Error(p.error);
  return p;
}

beforeAll(async () => {
  f = await createFixture();
  other = await createFixture();
  // Both orgs start with the same code at different prices.
  const base = { name: 'Night guard', category: 'Prosthodontics', taxCategory: 'goods_prosthetic', hsnSacCode: '9021', gstRateBp: 500 };
  expect((await createCatalogueItem(f.ctx('owner'), { ...base, code: 'NGD', price: '2000' })).ok).toBe(true);
  expect((await createCatalogueItem(other.ctx('owner'), { ...base, code: 'NGD', price: '9999' })).ok).toBe(true);
});
afterAll(async () => {
  await closeDb();
});

describe('paste the price list from Excel (T25)', () => {
  const paste = tsv(
    HEADER,
    ['PIMP', 'Implant fixture', 'Implants', '₹25,000', 'implant', '9021', '5%'],
    ['XRAY', 'IOPA X-ray', 'Diagnostics', '300/-', 'exempt', '9993', ''],
    ['ngd', 'Night guard (soft)', 'Prosthodontics', '2,500', 'prosthetic', '9021', '5'],
  );

  it('previews new rows and the update of an existing code, writing nothing', async () => {
    const p = await previewPlan(paste);
    expect(p.summary).toBe('2 new, 1 update, 0 errors');
    expect(p.rows.map((r) => [r.value?.code, r.status])).toEqual([['PIMP', 'new'], ['XRAY', 'new'], ['NGD', 'update']]);
    expect(p.rows[2]).toMatchObject({ oldPricePaise: 200_000, alsoChanges: ['Name'] });
    expect((await itemsByCode(f.orgId, ['PIMP', 'XRAY'])).size).toBe(0);
  });

  it('creates and updates in one go, audited like single saves', async () => {
    const p = await previewPlan(paste);
    const r = await saveCatalogueImport(f.ctx('owner'), paste, p.plan);
    expect(r).toEqual({ ok: true, created: 2, updated: 1 });

    const saved = await itemsByCode(f.orgId, ['PIMP', 'XRAY', 'NGD']);
    expect(saved.get('PIMP')).toMatchObject({ name: 'Implant fixture', defaultPricePaise: 2_500_000, taxCategory: 'goods_prosthetic', gstRateBp: 500, isGoods: true, active: true });
    expect(saved.get('XRAY')).toMatchObject({ defaultPricePaise: 30_000, taxCategory: 'exempt_healthcare', gstRateBp: 0, isGoods: false });
    expect(saved.get('NGD')).toMatchObject({ name: 'Night guard (soft)', defaultPricePaise: 250_000 });

    const audits = await getDb()
      .select()
      .from(auditLog)
      .where(inArray(auditLog.entityId, [...saved.values()].map((i) => i.id)));
    const byItem = (code: string) => audits.filter((a) => a.entityId === saved.get(code)!.id).map((a) => a.action);
    expect(byItem('PIMP')).toEqual(['catalogue.create']);
    expect(byItem('XRAY')).toEqual(['catalogue.create']);
    expect(byItem('NGD')).toEqual(expect.arrayContaining(['catalogue.create', 'catalogue.update']));
    const update = audits.find((a) => a.entityId === saved.get('NGD')!.id && a.action === 'catalogue.update')!;
    expect(update).toMatchObject({ orgId: f.orgId, actorId: f.ownerId, before: expect.objectContaining({ defaultPricePaise: 200_000 }), after: expect.objectContaining({ defaultPricePaise: 250_000 }) });
  });

  it('never touches another org’s item with the same code', async () => {
    const theirs = await itemsByCode(other.orgId, ['NGD', 'PIMP']);
    expect(theirs.get('NGD')).toMatchObject({ name: 'Night guard', defaultPricePaise: 999_900 });
    expect(theirs.has('PIMP')).toBe(false);
    // And their preview sees only their own list: PIMP is new for them.
    const p = await previewCatalogueImport(other.ctx('owner'), paste);
    expect(p.ok && p.rows.map((r) => r.status)).toEqual(['new', 'new', 'update']);
    expect(p.ok && p.rows[2]!.oldPricePaise).toBe(999_900);
  });

  it('saves nothing when one row is bad', async () => {
    const bad = tsv(['GOOD1', 'Good item', '', '100', 'retail', '3306', '18'], ['NGD', 'Night guard', '', '1', 'retail', '3306', '18'], ['BAD1', 'Bad item', '', 'abc', 'retail', '3306', '18']);
    const p = await previewCatalogueImport(f.ctx('owner'), bad);
    expect(p.ok && p.summary).toBe('1 new, 1 update, 1 error');
    // Even a client that sends a plan without the bad row is refused.
    const r = await saveCatalogueImport(f.ctx('owner'), bad, { newCodes: ['GOOD1'], updateCodes: ['NGD'] });
    expect(r).toMatchObject({ ok: false, error: IMPORT_HAS_ERRORS });
    expect((await itemsByCode(f.orgId, ['GOOD1', 'BAD1'])).size).toBe(0);
    expect((await itemsByCode(f.orgId, ['NGD'])).get('NGD')!.defaultPricePaise).toBe(250_000);
  });

  it('refuses to update a code the owner was shown as new', async () => {
    const text = tsv(['LATE', 'Late item', '', '500', 'retail', '3306', '18'], ['NEW2', 'Another', '', '700', 'retail', '3306', '18']);
    const p = await previewPlan(text);
    expect(p.plan).toEqual({ newCodes: ['LATE', 'NEW2'], updateCodes: [] });
    // Someone adds LATE by hand before the owner presses Save.
    expect((await createCatalogueItem(f.ctx('owner'), { code: 'LATE', name: 'Late by hand', category: '', price: '400', taxCategory: 'goods_retail', hsnSacCode: '3306', gstRateBp: 1800 })).ok).toBe(true);
    const r = await saveCatalogueImport(f.ctx('owner'), text, p.plan);
    expect(r).toMatchObject({ ok: false, error: IMPORT_CHANGED });
    const now = await itemsByCode(f.orgId, ['LATE', 'NEW2']);
    expect(now.get('LATE')).toMatchObject({ name: 'Late by hand', defaultPricePaise: 40_000 });
    expect(now.has('NEW2')).toBe(false);
    // A plan claiming an update the server doesn't see is refused too.
    const forged = await saveCatalogueImport(f.ctx('owner'), tsv(['NEW3', 'Third', '', '1', 'retail', '3306', '18']), { newCodes: [], updateCodes: ['NEW3'] });
    expect(forged).toMatchObject({ ok: false, error: IMPORT_CHANGED });
  });

  it('reports a paste over the limits without saving', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => [`L${i}`, `Item ${i}`, '', '100', 'retail', '3306', '18']);
    const r = await saveCatalogueImport(f.ctx('owner'), tsv(...rows), { newCodes: rows.map((x) => x[0]!), updateCodes: [] });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/at most 500/) });
    expect((await itemsByCode(f.orgId, ['L0'])).size).toBe(0);
  });

  it('is refused to the branch manager and the front desk', async () => {
    const text = tsv(['MGR1', 'Manager item', '', '100', 'retail', '3306', '18']);
    const plan = { newCodes: ['MGR1'], updateCodes: [] };
    await expect(previewCatalogueImport(f.ctx('manager'), text)).rejects.toThrow(ForbiddenError);
    await expect(saveCatalogueImport(f.ctx('manager'), text, plan)).rejects.toThrow(ForbiddenError);
    await expect(previewCatalogueImport(f.ctx('desk'), text)).rejects.toThrow(ForbiddenError);
    await expect(saveCatalogueImport(f.ctx('desk'), text, plan)).rejects.toThrow(ForbiddenError);
    expect((await itemsByCode(f.orgId, ['MGR1'])).size).toBe(0);
  });
});
