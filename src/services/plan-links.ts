import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { treatmentPlanItems } from '@/db/schema';

/**
 * Work recorded from a treatment plan and then found not done (removed on the
 * Unbilled page, or its bill cancelled with "No, it wasn't done") goes back
 * to "to do" on the plan, ready to be done again (LET-168).
 */
export async function reopenPlanItems(tx: Tx, orgId: string, procedureIds: string[]): Promise<void> {
  if (procedureIds.length === 0) return;
  await tx
    .update(treatmentPlanItems)
    .set({ status: 'planned', procedureId: null, doneAt: null })
    .where(and(eq(treatmentPlanItems.orgId, orgId), eq(treatmentPlanItems.status, 'done'), inArray(treatmentPlanItems.procedureId, procedureIds)));
}
