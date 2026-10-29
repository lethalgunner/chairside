import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { branches, patients, visits } from '@/db/schema';
import { businessDate } from '@/domain/dates';
import { canMoveVisit, type VisitStatus } from '@/domain/visits';
import { writeAudit } from './audit';
import { canDo, ForbiddenError, requireActiveBranch, UserFacingError, type TenantContext } from './context';
import { isUniqueViolation, isUuid } from './util';

/**
 * Today's waiting room (Sprint 3, T36). Tokens run 1, 2, 3… per branch per
 * business day. Only today's queue changes; past days are read-only. Every
 * change is audited. "Seen, not billed" = marked Done with no bill issued and
 * no work recorded for that patient at that branch that day: the walk-in
 * version of the leakage the Unbilled page catches for recorded work.
 */

export interface QueueRow {
  id: string;
  branchId: string;
  branchName: string;
  patientId: string;
  patientName: string;
  token: number;
  status: VisitStatus;
  arrivedAt: Date;
  seatedAt: Date | null;
  doneAt: Date | null;
  seenNotBilled: boolean;
}

/** Add a patient to today's queue at the active branch. Returns the token. */
export async function addToQueue(ctx: TenantContext, patientId: string): Promise<{ visitId: string; token: number }> {
  const branchId = requireActiveBranch(ctx);
  if (!canDo(ctx, 'visit.manage', branchId)) throw new ForbiddenError();
  if (!isUuid(patientId)) throw new ForbiddenError();
  const db = getDb();
  const [p] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.orgId, ctx.orgId))).limit(1);
  if (!p) throw new ForbiddenError();
  const today = businessDate();

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [next] = await tx
          .select({ n: sql<number>`coalesce(max(${visits.token}), 0)::int + 1` })
          .from(visits)
          .where(and(eq(visits.branchId, branchId), eq(visits.businessDate, today)));
        const token = next?.n ?? 1;
        const [v] = await tx
          .insert(visits)
          .values({ orgId: ctx.orgId, branchId, patientId, businessDate: today, token, createdBy: ctx.userId })
          .returning({ id: visits.id });
        await writeAudit(tx, ctx, { action: 'visit.add', entityType: 'visit', entityId: v!.id, branchId, after: { token, status: 'waiting' } });
        return { visitId: v!.id, token };
      });
    } catch (err) {
      if (isUniqueViolation(err, 'visits_branch_day_patient_active_unique')) {
        const [cur] = await db
          .select({ token: visits.token })
          .from(visits)
          .where(and(eq(visits.branchId, branchId), eq(visits.businessDate, today), eq(visits.patientId, patientId), inArray(visits.status, ['waiting', 'in_chair'])))
          .limit(1);
        throw new UserFacingError(`Already in today’s queue${cur ? ` as token ${cur.token}` : ''}.`);
      }
      // Two desks took the same token at the same moment: try the next number.
      if (isUniqueViolation(err, 'visits_branch_day_token_unique')) continue;
      throw err;
    }
  }
  throw new UserFacingError('The queue is busy. Press again.');
}

/** Waiting → In chair → Done, or Left; In chair → Waiting undoes a mistaken seat. */
export async function moveVisit(ctx: TenantContext, visitId: string, to: VisitStatus): Promise<void> {
  if (!isUuid(visitId)) throw new ForbiddenError();
  await getDb().transaction(async (tx) => {
    const [v] = await tx
      .select()
      .from(visits)
      .where(and(eq(visits.id, visitId), eq(visits.orgId, ctx.orgId)))
      .for('update');
    if (!v || !canDo(ctx, 'visit.manage', v.branchId)) throw new ForbiddenError();
    if (v.businessDate !== businessDate()) throw new UserFacingError('Only today’s queue can change.');
    const from = v.status as VisitStatus;
    if (from === to) return;
    if (!canMoveVisit(from, to)) throw new UserFacingError(from === 'done' || from === 'left' ? 'This visit is already finished.' : 'That step isn’t possible from here.');
    const now = new Date();
    await tx
      .update(visits)
      .set({
        status: to,
        ...(to === 'in_chair' ? { seatedAt: now } : {}),
        ...(to === 'waiting' ? { seatedAt: null } : {}),
        ...(to === 'done' || to === 'left' ? { doneAt: now } : {}),
      })
      .where(and(eq(visits.id, v.id), eq(visits.orgId, ctx.orgId)));
    await writeAudit(tx, ctx, { action: 'visit.move', entityType: 'visit', entityId: v.id, branchId: v.branchId, before: { status: from }, after: { status: to } });
  });
}

/** The queue for a day at the given branches the user can see. */
export async function queueFor(ctx: TenantContext, branchIds: string[], date: string = businessDate()): Promise<QueueRow[]> {
  const ids = branchIds.filter((b) => ctx.branchIds.includes(b));
  if (ids.length === 0) return [];
  // Done, and nothing billed or recorded for that patient at that branch that day.
  const seenNotBilled = sql<boolean>`(visits.status = 'done'
    and not exists (select 1 from invoices i where i.org_id = visits.org_id and i.branch_id = visits.branch_id and i.patient_id = visits.patient_id and i.issued_on = visits.business_date and i.status = 'issued')
    and not exists (select 1 from procedures_performed pp where pp.org_id = visits.org_id and pp.branch_id = visits.branch_id and pp.patient_id = visits.patient_id
                    and to_char(pp.performed_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') = to_char(visits.business_date, 'YYYY-MM-DD')))`;
  const rows = await getDb()
    .select({ v: visits, branchName: branches.name, patientName: patients.fullName, seenNotBilled })
    .from(visits)
    .innerJoin(branches, eq(branches.id, visits.branchId))
    .innerJoin(patients, eq(patients.id, visits.patientId))
    .where(and(eq(visits.orgId, ctx.orgId), inArray(visits.branchId, ids), eq(visits.businessDate, date)))
    .orderBy(asc(visits.branchId), asc(visits.token));
  return rows.map(({ v, branchName, patientName, seenNotBilled: snb }) => ({
    id: v.id,
    branchId: v.branchId,
    branchName,
    patientId: v.patientId,
    patientName,
    token: v.token,
    status: v.status as VisitStatus,
    arrivedAt: v.arrivedAt,
    seatedAt: v.seatedAt,
    doneAt: v.doneAt,
    seenNotBilled: snb === true,
  }));
}

/** Today's open visit for a patient at the active branch, for the patient page. */
export async function openVisitFor(ctx: TenantContext, patientId: string): Promise<{ id: string; token: number; status: VisitStatus } | null> {
  if (ctx.activeBranchId === 'all' || !isUuid(patientId)) return null;
  const [v] = await getDb()
    .select({ id: visits.id, token: visits.token, status: visits.status })
    .from(visits)
    .where(
      and(
        eq(visits.orgId, ctx.orgId),
        eq(visits.branchId, ctx.activeBranchId),
        eq(visits.patientId, patientId),
        eq(visits.businessDate, businessDate()),
        inArray(visits.status, ['waiting', 'in_chair']),
      ),
    )
    .limit(1);
  return v ? { id: v.id, token: v.token, status: v.status as VisitStatus } : null;
}
