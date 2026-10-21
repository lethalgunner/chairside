import { and, asc, desc, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { getDb, type DB, type Tx } from '@/db/client';
import { catalogueItems, memberships, priceListEntries, users } from '@/db/schema';
import { businessDate } from '@/domain/dates';
import { checkCatalogueItem, type CatalogueItemInput } from '@/domain/catalogue';
import type { Paise } from '@/domain/money';
import type { FieldErrors } from '@/domain/staff';
import type { TaxCategory } from '@/domain/tax';
import { writeAudit } from './audit';
import { canAnywhere, ForbiddenError, type TenantContext } from './context';
import { isUniqueViolation, isUuid } from './util';

export interface CatalogueEntry {
  id: string;
  code: string;
  name: string;
  category: string | null;
  pricePaise: Paise;
  taxCategory: TaxCategory;
  hsnSacCode: string;
  gstRateBp: number;
}

/** Active items with the price that applies at this branch today (branch override, else default). */
export async function listCatalogue(
  ctx: TenantContext,
  branchId: string,
  db: DB | Tx = getDb(),
): Promise<CatalogueEntry[]> {
  const items = await db
    .select()
    .from(catalogueItems)
    .where(and(eq(catalogueItems.orgId, ctx.orgId), eq(catalogueItems.active, true)))
    .orderBy(asc(catalogueItems.category), asc(catalogueItems.name));
  if (items.length === 0) return [];
  const overrides = await db
    .select()
    .from(priceListEntries)
    .where(
      and(
        eq(priceListEntries.orgId, ctx.orgId),
        inArray(
          priceListEntries.catalogueItemId,
          items.map((i) => i.id),
        ),
        or(eq(priceListEntries.branchId, branchId), isNull(priceListEntries.branchId)),
        isNull(priceListEntries.doctorId),
        lte(priceListEntries.effectiveFrom, businessDate()),
      ),
    )
    .orderBy(desc(priceListEntries.effectiveFrom));
  const price = new Map<string, number>();
  // Branch-specific beats org-wide; latest effective date wins within each.
  for (const o of overrides.filter((o) => o.branchId === null)) if (!price.has(o.catalogueItemId)) price.set(o.catalogueItemId, o.pricePaise);
  const branchPrice = new Map<string, number>();
  for (const o of overrides.filter((o) => o.branchId === branchId)) if (!branchPrice.has(o.catalogueItemId)) branchPrice.set(o.catalogueItemId, o.pricePaise);
  return items.map((i) => ({
    id: i.id,
    code: i.code,
    name: i.name,
    category: i.category,
    pricePaise: (branchPrice.get(i.id) ?? price.get(i.id) ?? i.defaultPricePaise) as Paise,
    taxCategory: i.taxCategory as TaxCategory,
    hsnSacCode: i.hsnSacCode,
    gstRateBp: i.gstRateBp,
  }));
}

export interface DoctorOption {
  id: string;
  fullName: string;
}

/** People who can be credited with a procedure at this branch. */
export async function listDoctors(ctx: TenantContext, branchId: string): Promise<DoctorOption[]> {
  const rows = await getDb()
    .selectDistinct({ id: users.id, fullName: users.fullName })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(
      and(
        eq(users.orgId, ctx.orgId),
        eq(users.active, true),
        inArray(memberships.role, ['doctor', 'associate_doctor']),
        or(eq(memberships.branchId, branchId), isNull(memberships.branchId)),
      ),
    )
    .orderBy(asc(users.fullName));
  return rows;
}

// ---------------------------------------------------------------------------
// Price list settings (Pilot 0 slice 2, T15). Items are org-level and never
// deleted: issued invoice lines reference them. A price or rate change only
// affects bills issued afterwards, because each line snapshots both at issue.
// ---------------------------------------------------------------------------

function assertCatalogueManager(ctx: TenantContext): void {
  if (!canAnywhere(ctx, 'catalogue.manage')) throw new ForbiddenError();
}

export interface CatalogueAdminRow extends CatalogueEntry {
  active: boolean;
  isGoods: boolean;
}

/** Every item, active or not, at its org-wide default price. */
export async function listCatalogueForSettings(ctx: TenantContext): Promise<CatalogueAdminRow[]> {
  assertCatalogueManager(ctx);
  const rows = await getDb()
    .select()
    .from(catalogueItems)
    .where(eq(catalogueItems.orgId, ctx.orgId))
    .orderBy(desc(catalogueItems.active), asc(catalogueItems.category), asc(catalogueItems.name));
  return rows.map((i) => ({
    id: i.id,
    code: i.code,
    name: i.name,
    category: i.category,
    pricePaise: i.defaultPricePaise as Paise,
    taxCategory: i.taxCategory as TaxCategory,
    hsnSacCode: i.hsnSacCode,
    gstRateBp: i.gstRateBp,
    active: i.active,
    isGoods: i.isGoods,
  }));
}

export type SaveItemResult = { ok: true; id: string } | { ok: false; fieldErrors: FieldErrors };

export async function createCatalogueItem(ctx: TenantContext, input: CatalogueItemInput): Promise<SaveItemResult> {
  assertCatalogueManager(ctx);
  const checked = checkCatalogueItem(input);
  if (!checked.ok) return checked;
  try {
    return await getDb().transaction(async (tx) => {
      const [row] = await tx.insert(catalogueItems).values({ orgId: ctx.orgId, ...checked.value }).returning({ id: catalogueItems.id });
      await writeAudit(tx, ctx, { action: 'catalogue.create', entityType: 'catalogue_item', entityId: row!.id, after: checked.value });
      return { ok: true as const, id: row!.id };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'catalogue_org_code_unique')) return { ok: false, fieldErrors: { code: `Code ${checked.value.code} is already used. Pick another.` } };
    throw err;
  }
}

async function lockItem(tx: Tx, ctx: TenantContext, id: string) {
  if (!isUuid(id)) throw new ForbiddenError();
  const [item] = await tx
    .select()
    .from(catalogueItems)
    .where(and(eq(catalogueItems.id, id), eq(catalogueItems.orgId, ctx.orgId)))
    .for('update');
  if (!item) throw new ForbiddenError();
  return item;
}

/** Edit an item. The code is fixed once created: the seed and imports match on it. */
export async function updateCatalogueItem(ctx: TenantContext, id: string, input: CatalogueItemInput): Promise<SaveItemResult> {
  assertCatalogueManager(ctx);
  return getDb().transaction(async (tx) => {
    const item = await lockItem(tx, ctx, id);
    const checked = checkCatalogueItem({ ...input, code: item.code });
    if (!checked.ok) return checked;
    await tx.update(catalogueItems).set(checked.value).where(and(eq(catalogueItems.id, item.id), eq(catalogueItems.orgId, ctx.orgId)));
    const { id: _id, orgId: _org, ...before } = item;
    await writeAudit(tx, ctx, { action: 'catalogue.update', entityType: 'catalogue_item', entityId: item.id, before, after: checked.value });
    return { ok: true as const, id: item.id };
  });
}

/** Deactivate (hide from new bills) or bring back. Items are never deleted. */
export async function setCatalogueItemActive(ctx: TenantContext, id: string, active: boolean): Promise<void> {
  assertCatalogueManager(ctx);
  await getDb().transaction(async (tx) => {
    const item = await lockItem(tx, ctx, id);
    if (item.active === active) return;
    await tx.update(catalogueItems).set({ active }).where(and(eq(catalogueItems.id, item.id), eq(catalogueItems.orgId, ctx.orgId)));
    await writeAudit(tx, ctx, {
      action: active ? 'catalogue.reactivate' : 'catalogue.deactivate',
      entityType: 'catalogue_item',
      entityId: item.id,
      before: { active: item.active },
      after: { active },
    });
  });
}
