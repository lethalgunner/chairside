import { and, asc, desc, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { getDb, type DB, type Tx } from '@/db/client';
import { catalogueItems, memberships, priceListEntries, users } from '@/db/schema';
import { businessDate } from '@/domain/dates';
import type { Paise } from '@/domain/money';
import type { TaxCategory } from '@/domain/tax';
import type { TenantContext } from './context';

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
