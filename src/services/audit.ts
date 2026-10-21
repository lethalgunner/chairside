import { auditLog } from '@/db/schema';
import type { DB, Tx } from '@/db/client';

/**
 * Record a write. Pilot 0 keeps this an ordinary insert-only table; append-only
 * enforcement and the hash chain arrive before go-live (ADR-012). Never put
 * clinical text here.
 */
export async function writeAudit(
  db: DB | Tx,
  // userId is null only for command-line admin scripts, which have no signed-in actor.
  actor: { orgId: string; userId: string | null },
  entry: {
    action: string;
    entityType: string;
    entityId?: string | null;
    branchId?: string | null;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await db.insert(auditLog).values({
    orgId: actor.orgId,
    actorId: actor.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    branchId: entry.branchId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}
