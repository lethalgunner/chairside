import { eq } from 'drizzle-orm';
import { getDb, type DB, type Tx } from '@/db/client';
import { roleDiscountCaps } from '@/db/schema';
import { CAPPABLE_ROLES, checkDiscountCaps, effectiveCapBp, type DiscountCaps } from '@/domain/discounts';
import { canOrgWide, type Role } from '@/domain/permissions';
import type { FieldErrors } from '@/domain/staff';
import { writeAudit } from './audit';
import { ForbiddenError, type TenantContext } from './context';

/** Discount limits per role (Sprint 8). Read by billing; set by the owner in Settings → Clinic. */

export async function loadDiscountCaps(db: DB | Tx, orgId: string): Promise<DiscountCaps> {
  const rows = await db.select({ role: roleDiscountCaps.role, maxBp: roleDiscountCaps.maxBp }).from(roleDiscountCaps).where(eq(roleDiscountCaps.orgId, orgId));
  const caps: DiscountCaps = {};
  for (const r of rows) if ((CAPPABLE_ROLES as readonly string[]).includes(r.role)) caps[r.role as Role] = r.maxBp;
  return caps;
}

/** This person's limit at a branch in basis points, or null for none. */
export async function myDiscountCapBp(ctx: TenantContext, branchId: string, db: DB | Tx = getDb()): Promise<number | null> {
  return effectiveCapBp(ctx.grants, branchId, await loadDiscountCaps(db, ctx.orgId));
}

export async function getDiscountCaps(ctx: TenantContext): Promise<DiscountCaps> {
  if (!canOrgWide(ctx.grants, 'staff.manage')) throw new ForbiddenError();
  return loadDiscountCaps(getDb(), ctx.orgId);
}

/** Owner only. Blank for a role removes its limit. */
export async function saveDiscountCaps(ctx: TenantContext, raw: Record<string, string>): Promise<{ ok: true } | { ok: false; fieldErrors: FieldErrors }> {
  if (!canOrgWide(ctx.grants, 'staff.manage')) throw new ForbiddenError();
  const checked = checkDiscountCaps(raw);
  if (!checked.ok) return checked;
  return getDb().transaction(async (tx) => {
    const before = await loadDiscountCaps(tx, ctx.orgId);
    await tx.delete(roleDiscountCaps).where(eq(roleDiscountCaps.orgId, ctx.orgId));
    const rows = Object.entries(checked.value).map(([role, maxBp]) => ({ orgId: ctx.orgId, role, maxBp: maxBp! }));
    if (rows.length) await tx.insert(roleDiscountCaps).values(rows);
    await writeAudit(tx, ctx, { action: 'clinic.discount_caps', entityType: 'organisation', entityId: ctx.orgId, before, after: checked.value });
    return { ok: true as const };
  });
}
