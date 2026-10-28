import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { proceduresPerformed } from '@/db/schema';
import { procedureDismissal } from '@/domain/corrections';
import { assertCan, ForbiddenError, UserFacingError, type TenantContext } from './context';
import { writeAudit } from './audit';
import { isUuid } from './util';

/**
 * "Not done: remove" on the Unbilled list (Q20, T28). The procedure is marked
 * not done, never deleted: it leaves Done-not-billed and the dashboard figure,
 * and can't be billed afterwards. Owner or branch manager at the procedure's
 * branch (`procedure.dismiss`); the reason is required and audited.
 */
export async function dismissProcedure(ctx: TenantContext, procedureId: string, reasonRaw: string): Promise<void> {
  if (!isUuid(procedureId)) throw new ForbiddenError();
  await getDb().transaction(async (tx) => {
    const [proc] = await tx
      .select({
        id: proceduresPerformed.id,
        branchId: proceduresPerformed.branchId,
        invoiceLineId: proceduresPerformed.invoiceLineId,
        dismissedAt: proceduresPerformed.dismissedAt,
      })
      .from(proceduresPerformed)
      .where(and(eq(proceduresPerformed.id, procedureId), eq(proceduresPerformed.orgId, ctx.orgId)))
      .for('update');
    if (!proc) throw new ForbiddenError();
    assertCan(ctx, 'procedure.dismiss', proc.branchId);
    const verdict = procedureDismissal({ invoiceLineId: proc.invoiceLineId, dismissedAt: proc.dismissedAt, reason: reasonRaw });
    if (!verdict.allowed) throw new UserFacingError(verdict.reason);
    await tx
      .update(proceduresPerformed)
      .set({ dismissedAt: new Date(), dismissedBy: ctx.userId, dismissReason: verdict.reason })
      .where(and(eq(proceduresPerformed.id, proc.id), isNull(proceduresPerformed.dismissedAt), isNull(proceduresPerformed.invoiceLineId)));
    await writeAudit(tx, ctx, {
      action: 'procedure.dismiss',
      entityType: 'procedure',
      entityId: proc.id,
      branchId: proc.branchId,
      before: { dismissed: false },
      after: { dismissed: true, reason: verdict.reason },
    });
  });
}
