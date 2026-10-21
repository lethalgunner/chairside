import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb, type DB, type Tx } from '@/db/client';
import { branches } from '@/db/schema';
import { checkBranchDetails, type BranchDetailsInput } from '@/domain/branch';
import type { Paise } from '@/domain/money';
import type { FieldErrors } from '@/domain/staff';
import { writeAudit } from './audit';
import { canDo, ForbiddenError, type TenantContext } from './context';

export interface BranchInfo {
  id: string;
  name: string;
  code: string;
  city: string | null;
  state: string | null;
  gstRegistered: boolean;
  gstin: string | null;
  dayCloseTolerancePaise: Paise;
  defaultFloatPaise: Paise;
}

function toInfo(b: typeof branches.$inferSelect): BranchInfo {
  return {
    id: b.id,
    name: b.name,
    code: b.code,
    city: b.city,
    state: b.state,
    gstRegistered: b.gstRegistered,
    gstin: b.gstin,
    dayCloseTolerancePaise: b.dayCloseTolerancePaise as Paise,
    defaultFloatPaise: b.defaultFloatPaise as Paise,
  };
}

export async function listBranches(ctx: TenantContext): Promise<BranchInfo[]> {
  const rows = await getDb()
    .select()
    .from(branches)
    .where(and(eq(branches.orgId, ctx.orgId), inArray(branches.id, ctx.branchIds)))
    .orderBy(asc(branches.name));
  return rows.map(toInfo);
}

/** A branch this user can see, or ForbiddenError. Optionally row-locked inside a transaction. */
export async function getBranch(ctx: TenantContext, branchId: string, db: DB | Tx = getDb()): Promise<BranchInfo> {
  if (!ctx.branchIds.includes(branchId)) throw new ForbiddenError();
  const [b] = await db
    .select()
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.orgId, ctx.orgId)))
    .limit(1);
  if (!b) throw new ForbiddenError();
  return toInfo(b);
}

// ---------------------------------------------------------------------------
// Branch settings (Pilot 0 slice 2, T16). Owner only (branch.manage): GST
// registration and the GSTIN decide the tax on every future bill, and the
// tolerance decides which cash shortfall needs a written reason, so the
// person whose drawer is checked should not be the one setting them.
// ---------------------------------------------------------------------------

export interface BranchSettings extends BranchInfo {
  addressLine: string | null;
  phone: string | null;
}

/** Branches this user may edit, with every editable field. */
export async function listBranchSettings(ctx: TenantContext): Promise<BranchSettings[]> {
  const editable = ctx.branchIds.filter((b) => canDo(ctx, 'branch.manage', b));
  if (editable.length === 0) throw new ForbiddenError();
  const rows = await getDb()
    .select()
    .from(branches)
    .where(and(eq(branches.orgId, ctx.orgId), inArray(branches.id, editable)))
    .orderBy(asc(branches.name));
  return rows.map((b) => ({ ...toInfo(b), addressLine: b.addressLine, phone: b.phone }));
}

export type SaveBranchResult = { ok: true } | { ok: false; fieldErrors: FieldErrors };

/**
 * Save branch details. Issued bills are unaffected: each snapshots the GST
 * status and GSTIN it was issued under. The code is never editable here.
 */
export async function updateBranchDetails(ctx: TenantContext, branchId: string, input: BranchDetailsInput): Promise<SaveBranchResult> {
  if (!canDo(ctx, 'branch.manage', branchId)) throw new ForbiddenError();
  const checked = checkBranchDetails(input);
  if (!checked.ok) return checked;
  return getDb().transaction(async (tx) => {
    const [b] = await tx
      .select()
      .from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.orgId, ctx.orgId)))
      .for('update');
    if (!b) throw new ForbiddenError();
    await tx.update(branches).set(checked.value).where(and(eq(branches.id, b.id), eq(branches.orgId, ctx.orgId)));
    const before = {
      name: b.name,
      addressLine: b.addressLine,
      city: b.city,
      state: b.state,
      phone: b.phone,
      gstRegistered: b.gstRegistered,
      gstin: b.gstin,
      dayCloseTolerancePaise: b.dayCloseTolerancePaise,
      defaultFloatPaise: b.defaultFloatPaise,
    };
    await writeAudit(tx, ctx, { action: 'branch.update', entityType: 'branch', entityId: b.id, branchId: b.id, before, after: checked.value });
    return { ok: true as const };
  });
}
