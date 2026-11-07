import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, type Tx } from '@/db/client';
import { catalogueItems, medicines, stockItems, stockMovements, users } from '@/db/schema';
import { businessDate } from '@/domain/dates';
import { checkMovement, checkStockItem, mayExpireOn, stockFlags, type MovementInput, type StockItemInput, type StockKind } from '@/domain/stock';
import type { FieldErrors } from '@/domain/staff';
import { writeAudit } from './audit';
import { canDo, ForbiddenError, requireActiveBranch, UserFacingError, type TenantContext } from './context';
import { isUniqueViolation, isUuid } from './util';

/**
 * Stock-lite (Sprint 6, LET-176). Items are org-wide; stock is per branch.
 * Movements are append-only and on hand is their sum. Selling a linked item
 * on a bill writes the "sold" movement in the bill's own transaction.
 */

export interface StockRow {
  id: string;
  kind: StockKind;
  name: string;
  unit: string;
  reorderLevel: number;
  active: boolean;
  medicineId: string | null;
  catalogueItemId: string | null;
  soldAs: string | null;
  onHand: number;
  mayExpireOn: string | null;
  low: boolean;
  expiring: boolean;
  expired: boolean;
}

function assertStock(ctx: TenantContext, branchId: string) {
  if (!canDo(ctx, 'stock.manage', branchId) && !canDo(ctx, 'report.branch', branchId)) throw new ForbiddenError();
}

/** Every item with what is on hand at this branch, low and expiry flags. */
export async function listStock(ctx: TenantContext, branchId: string): Promise<StockRow[]> {
  if (!isUuid(branchId) || !ctx.branchIds.includes(branchId)) throw new ForbiddenError();
  assertStock(ctx, branchId);
  const db = getDb();
  const items = await db
    .select({ i: stockItems, soldAs: catalogueItems.name })
    .from(stockItems)
    .leftJoin(catalogueItems, eq(catalogueItems.id, stockItems.catalogueItemId))
    .where(eq(stockItems.orgId, ctx.orgId))
    .orderBy(desc(stockItems.active), asc(stockItems.kind), asc(stockItems.name));
  if (items.length === 0) return [];
  const ids = items.map((x) => x.i.id);
  const sums = await db
    .select({ id: stockMovements.stockItemId, q: sql<number>`coalesce(sum(${stockMovements.quantity}), 0)::int` })
    .from(stockMovements)
    .where(and(eq(stockMovements.orgId, ctx.orgId), eq(stockMovements.branchId, branchId), inArray(stockMovements.stockItemId, ids)))
    .groupBy(stockMovements.stockItemId);
  const received = await db
    .select({ id: stockMovements.stockItemId, quantity: stockMovements.quantity, expiresOn: stockMovements.expiresOn, at: stockMovements.createdAt })
    .from(stockMovements)
    .where(and(eq(stockMovements.orgId, ctx.orgId), eq(stockMovements.branchId, branchId), inArray(stockMovements.stockItemId, ids), eq(stockMovements.kind, 'received')));
  const today = businessDate();
  return items.map(({ i, soldAs }) => {
    const onHand = sums.find((s) => s.id === i.id)?.q ?? 0;
    const exp = mayExpireOn(onHand, received.filter((r) => r.id === i.id));
    return {
      id: i.id,
      kind: i.kind as StockKind,
      name: i.name,
      unit: i.unit,
      reorderLevel: i.reorderLevel,
      active: i.active,
      medicineId: i.medicineId,
      catalogueItemId: i.catalogueItemId,
      soldAs,
      onHand,
      mayExpireOn: exp,
      ...stockFlags(onHand, i.reorderLevel, exp, today),
    };
  });
}

export type SaveStockResult = { ok: true; id: string } | { ok: false; fieldErrors: FieldErrors };

/** Add an item: a medicine from the list, or a clinic supply by name. Optionally sold as a price-list item. */
export async function saveStockItem(ctx: TenantContext, id: string | null, input: StockItemInput & { medicineId: string; catalogueItemId: string }): Promise<SaveStockResult> {
  const branchId = requireActiveBranch(ctx);
  if (!canDo(ctx, 'stock.manage', branchId)) throw new ForbiddenError();
  const db = getDb();
  let name = input.name;
  let medicineId: string | null = null;
  if (input.kind === 'medicine' && input.medicineId) {
    if (!isUuid(input.medicineId)) throw new ForbiddenError();
    const [m] = await db.select().from(medicines).where(and(eq(medicines.id, input.medicineId), eq(medicines.orgId, ctx.orgId)));
    if (!m) throw new ForbiddenError();
    medicineId = m.id;
    name = name.trim() || `${m.name}${m.strength ? ` ${m.strength}` : ''}`;
  }
  const checked = checkStockItem({ ...input, name });
  if (!checked.ok) return checked;
  if (checked.value.kind === 'medicine' && !medicineId && id === null) return { ok: false, fieldErrors: { medicineId: 'Pick the medicine from your medicine list.' } };
  let catalogueItemId: string | null = null;
  if (input.catalogueItemId) {
    if (!isUuid(input.catalogueItemId)) throw new ForbiddenError();
    const [c] = await db.select({ id: catalogueItems.id, isGoods: catalogueItems.isGoods }).from(catalogueItems).where(and(eq(catalogueItems.id, input.catalogueItemId), eq(catalogueItems.orgId, ctx.orgId)));
    if (!c) throw new ForbiddenError();
    if (!c.isGoods) return { ok: false, fieldErrors: { catalogueItemId: 'Only goods on the price list (retail or prosthetic) can be sold from stock.' } };
    catalogueItemId = c.id;
  }
  try {
    return await db.transaction(async (tx) => {
      if (id === null) {
        const [row] = await tx.insert(stockItems).values({ orgId: ctx.orgId, ...checked.value, medicineId, catalogueItemId }).returning({ id: stockItems.id });
        await writeAudit(tx, ctx, { action: 'stock.item_create', entityType: 'stock_item', entityId: row!.id, after: { ...checked.value, medicineId, catalogueItemId } });
        return { ok: true as const, id: row!.id };
      }
      if (!isUuid(id)) throw new ForbiddenError();
      const [before] = await tx.select().from(stockItems).where(and(eq(stockItems.id, id), eq(stockItems.orgId, ctx.orgId))).for('update');
      if (!before) throw new ForbiddenError();
      const { kind: _k, ...editable } = checked.value;
      await tx.update(stockItems).set({ ...editable, catalogueItemId }).where(eq(stockItems.id, before.id));
      await writeAudit(tx, ctx, { action: 'stock.item_update', entityType: 'stock_item', entityId: before.id, before, after: { ...editable, catalogueItemId } });
      return { ok: true as const, id: before.id };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'stock_items_medicine_unique')) return { ok: false, fieldErrors: { medicineId: 'That medicine is already in stock items.' } };
    if (isUniqueViolation(err, 'stock_items_catalogue_unique')) return { ok: false, fieldErrors: { catalogueItemId: 'Another stock item is already sold as that price-list item.' } };
    if (isUniqueViolation(err, 'stock_items_name_unique')) return { ok: false, fieldErrors: { name: 'An item with that name already exists.' } };
    throw err;
  }
}

/** Received, used or adjusted, at the active branch. Audited; never edited afterwards. */
export async function recordMovement(ctx: TenantContext, stockItemId: string, input: MovementInput): Promise<{ ok: true; onHand: number } | { ok: false; fieldErrors: FieldErrors }> {
  const branchId = requireActiveBranch(ctx);
  if (!canDo(ctx, 'stock.manage', branchId)) throw new ForbiddenError();
  if (!isUuid(stockItemId)) throw new ForbiddenError();
  const checked = checkMovement(input, businessDate());
  if (!checked.ok) return checked;
  return getDb().transaction(async (tx) => {
    const [item] = await tx.select().from(stockItems).where(and(eq(stockItems.id, stockItemId), eq(stockItems.orgId, ctx.orgId))).for('update');
    if (!item) throw new ForbiddenError();
    if (!item.active) throw new UserFacingError('This item is hidden. Bring it back first.');
    const [row] = await tx.insert(stockMovements).values({ orgId: ctx.orgId, branchId, stockItemId: item.id, ...checked.value, createdBy: ctx.userId }).returning({ id: stockMovements.id });
    const [sum] = await tx.select({ q: sql<number>`coalesce(sum(${stockMovements.quantity}), 0)::int` }).from(stockMovements).where(and(eq(stockMovements.stockItemId, item.id), eq(stockMovements.branchId, branchId)));
    await writeAudit(tx, ctx, { action: `stock.${checked.value.kind}`, entityType: 'stock_item', entityId: item.id, branchId, after: { movementId: row!.id, quantity: checked.value.quantity, expiresOn: checked.value.expiresOn } });
    return { ok: true as const, onHand: sum?.q ?? 0 };
  });
}

export async function setStockItemActive(ctx: TenantContext, id: string, active: boolean): Promise<void> {
  const branchId = requireActiveBranch(ctx);
  if (!canDo(ctx, 'stock.manage', branchId) || !isUuid(id)) throw new ForbiddenError();
  await getDb().transaction(async (tx) => {
    const [i] = await tx.select().from(stockItems).where(and(eq(stockItems.id, id), eq(stockItems.orgId, ctx.orgId))).for('update');
    if (!i) throw new ForbiddenError();
    if (i.active === active) return;
    await tx.update(stockItems).set({ active }).where(eq(stockItems.id, i.id));
    await writeAudit(tx, ctx, { action: active ? 'stock.item_reactivate' : 'stock.item_hide', entityType: 'stock_item', entityId: i.id });
  });
}

/** The last movements of an item at a branch, newest first. */
export async function stockHistory(ctx: TenantContext, branchId: string, stockItemId: string) {
  if (!isUuid(stockItemId) || !ctx.branchIds.includes(branchId)) return [];
  assertStock(ctx, branchId);
  return getDb()
    .select({ id: stockMovements.id, kind: stockMovements.kind, quantity: stockMovements.quantity, expiresOn: stockMovements.expiresOn, reason: stockMovements.reason, at: stockMovements.createdAt, by: users.fullName })
    .from(stockMovements)
    .innerJoin(users, eq(users.id, stockMovements.createdBy))
    .where(and(eq(stockMovements.orgId, ctx.orgId), eq(stockMovements.branchId, branchId), eq(stockMovements.stockItemId, stockItemId)))
    .orderBy(desc(stockMovements.createdAt))
    .limit(30);
}

/**
 * Called inside issueBill's transaction (LET-176): each billed line whose
 * price-list item is sold from stock takes that many units out at the branch.
 * Stock may go below zero (the sale happened); the Stock page shows it.
 */
export async function takeSoldStock(tx: Tx, orgId: string, branchId: string, actorId: string, lines: { invoiceLineId: string; catalogueItemId: string | null; quantity: number }[]): Promise<void> {
  const ids = [...new Set(lines.map((l) => l.catalogueItemId).filter((x): x is string => !!x))];
  if (ids.length === 0) return;
  const items = await tx.select({ id: stockItems.id, catalogueItemId: stockItems.catalogueItemId }).from(stockItems).where(and(eq(stockItems.orgId, orgId), eq(stockItems.active, true), inArray(stockItems.catalogueItemId, ids)));
  for (const l of lines) {
    const item = items.find((i) => i.catalogueItemId === l.catalogueItemId);
    if (!item) continue;
    await tx.insert(stockMovements).values({ orgId, branchId, stockItemId: item.id, kind: 'sold', quantity: -l.quantity, invoiceLineId: l.invoiceLineId, createdBy: actorId });
  }
}

/** A bill cancelled with "not handed over": its sold stock comes back. */
export async function returnSoldStock(tx: Tx, orgId: string, actorId: string, invoiceLineIds: string[], reason: string): Promise<void> {
  if (invoiceLineIds.length === 0) return;
  const sold = await tx.select().from(stockMovements).where(and(eq(stockMovements.orgId, orgId), eq(stockMovements.kind, 'sold'), inArray(stockMovements.invoiceLineId, invoiceLineIds)));
  for (const s of sold) {
    await tx.insert(stockMovements).values({ orgId, branchId: s.branchId, stockItemId: s.stockItemId, kind: 'returned', quantity: -s.quantity, invoiceLineId: s.invoiceLineId, reason: `Bill cancelled: ${reason}`.slice(0, 120), createdBy: actorId });
  }
}
