import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { organisations } from '@/db/schema';
import { canOrgWide } from '@/domain/permissions';
import type { FieldErrors } from '@/domain/staff';
import { writeAudit } from './audit';
import { ForbiddenError, type TenantContext } from './context';

/** Clinic-wide settings (Sprint 7, self-serve). */
export interface ClinicSettings {
  name: string;
  parallelRun: boolean;
}

export async function getClinicSettings(ctx: TenantContext): Promise<ClinicSettings> {
  const [o] = await getDb().select({ name: organisations.name, parallelRun: organisations.parallelRun }).from(organisations).where(eq(organisations.id, ctx.orgId)).limit(1);
  if (!o) throw new ForbiddenError();
  return o;
}

export type SaveClinicResult = { ok: true } | { ok: false; fieldErrors: FieldErrors };

/** Owner only (the same org-wide grant that manages the team). */
export async function saveClinicSettings(ctx: TenantContext, input: { name: string; parallelRun: boolean }): Promise<SaveClinicResult> {
  if (!canOrgWide(ctx.grants, 'staff.manage')) throw new ForbiddenError();
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) return { ok: false, fieldErrors: { name: 'Enter the clinic name (2 to 80 characters).' } };
  return getDb().transaction(async (tx) => {
    const [o] = await tx.select().from(organisations).where(eq(organisations.id, ctx.orgId)).for('update');
    if (!o) throw new ForbiddenError();
    await tx.update(organisations).set({ name, parallelRun: input.parallelRun }).where(eq(organisations.id, ctx.orgId));
    await writeAudit(tx, ctx, { action: 'clinic.update', entityType: 'organisation', entityId: ctx.orgId, before: { name: o.name, parallelRun: o.parallelRun }, after: { name, parallelRun: input.parallelRun } });
    return { ok: true as const };
  });
}
