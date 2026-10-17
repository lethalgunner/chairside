import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb, type DB, type Tx } from '@/db/client';
import { branches } from '@/db/schema';
import type { Paise } from '@/domain/money';
import { ForbiddenError, type TenantContext } from './context';

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
