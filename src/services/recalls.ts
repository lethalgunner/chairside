import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { branches, patients, recalls } from '@/db/schema';
import { addDays, businessDate, isIsoDate } from '@/domain/dates';
import { recallBucket, recallReminderText, type RecallBucket, type RecallKind, isRecallKind } from '@/domain/visits';
import { firstName, waLink, waNumber } from '@/domain/whatsapp';
import { writeAudit } from './audit';
import { canDo, ForbiddenError, requireActiveBranch, UserFacingError, type TenantContext } from './context';
import { isUuid } from './util';

/**
 * Next-visit recalls (Sprint 3, T37). One open recall per patient per branch:
 * setting a new one closes the old. The reminder is click-to-send WhatsApp
 * (ADR-014) and never names a treatment. Every write is audited.
 */

export interface RecallRow {
  id: string;
  branchId: string;
  branchName: string;
  patientId: string;
  patientName: string;
  dueOn: string;
  kind: RecallKind;
  bucket: RecallBucket;
  remindCount: number;
  lastRemindedAt: Date | null;
  /** wa.me link, or null without remind permission or an Indian mobile. */
  href: string | null;
}

/** How far ahead a recall can be set. */
export const MAX_RECALL_DAYS = 3 * 366;

export async function setRecall(ctx: TenantContext, patientId: string, kindRaw: string, dueOnRaw: string): Promise<{ recallId: string }> {
  const branchId = requireActiveBranch(ctx);
  if (!canDo(ctx, 'recall.manage', branchId)) throw new ForbiddenError();
  if (!isUuid(patientId)) throw new ForbiddenError();
  if (!isRecallKind(kindRaw)) throw new UserFacingError('Pick what the next visit is for.');
  const today = businessDate();
  if (!isIsoDate(dueOnRaw)) throw new UserFacingError('Pick the date the next visit is due.');
  if (dueOnRaw < today) throw new UserFacingError('Pick today or a later date.');
  if (dueOnRaw > addDays(today, MAX_RECALL_DAYS)) throw new UserFacingError('Pick a date within 3 years.');
  const kind = kindRaw;
  const dueOn = dueOnRaw;

  return getDb().transaction(async (tx) => {
    const [p] = await tx.select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.orgId, ctx.orgId))).limit(1);
    if (!p) throw new ForbiddenError();
    const old = await tx
      .select({ id: recalls.id, dueOn: recalls.dueOn, kind: recalls.kind })
      .from(recalls)
      .where(and(eq(recalls.orgId, ctx.orgId), eq(recalls.branchId, branchId), eq(recalls.patientId, patientId), eq(recalls.status, 'open')))
      .for('update');
    const now = new Date();
    for (const o of old) {
      await tx.update(recalls).set({ status: 'cancelled', closedBy: ctx.userId, closedAt: now }).where(eq(recalls.id, o.id));
      await writeAudit(tx, ctx, { action: 'recall.replace', entityType: 'recall', entityId: o.id, branchId, before: { status: 'open', dueOn: o.dueOn, kind: o.kind }, after: { status: 'cancelled' } });
    }
    const [r] = await tx.insert(recalls).values({ orgId: ctx.orgId, branchId, patientId, dueOn, kind, createdBy: ctx.userId }).returning({ id: recalls.id });
    await writeAudit(tx, ctx, { action: 'recall.set', entityType: 'recall', entityId: r!.id, branchId, after: { dueOn, kind } });
    return { recallId: r!.id };
  });
}

/** Booked or no longer needed. */
export async function closeRecall(ctx: TenantContext, recallId: string, outcome: 'done' | 'cancelled'): Promise<void> {
  if (!isUuid(recallId)) throw new ForbiddenError();
  await getDb().transaction(async (tx) => {
    const [r] = await tx.select().from(recalls).where(and(eq(recalls.id, recallId), eq(recalls.orgId, ctx.orgId))).for('update');
    if (!r || !canDo(ctx, 'recall.manage', r.branchId)) throw new ForbiddenError();
    if (r.status !== 'open') throw new UserFacingError('This recall is already closed.');
    await tx.update(recalls).set({ status: outcome, closedBy: ctx.userId, closedAt: new Date() }).where(eq(recalls.id, r.id));
    await writeAudit(tx, ctx, { action: 'recall.close', entityType: 'recall', entityId: r.id, branchId: r.branchId, before: { status: 'open' }, after: { status: outcome } });
  });
}

/** Note that a WhatsApp reminder was opened for this recall. */
export async function logRecallReminder(ctx: TenantContext, recallId: string): Promise<{ remindedAt: Date }> {
  if (!isUuid(recallId)) throw new ForbiddenError();
  return getDb().transaction(async (tx) => {
    const [r] = await tx.select().from(recalls).where(and(eq(recalls.id, recallId), eq(recalls.orgId, ctx.orgId))).for('update');
    if (!r || !canDo(ctx, 'patient.remind', r.branchId)) throw new ForbiddenError();
    if (r.status !== 'open') throw new UserFacingError('This recall is already closed. Refresh the page.');
    const now = new Date();
    await tx.update(recalls).set({ remindCount: sql`${recalls.remindCount} + 1`, lastRemindedAt: now }).where(eq(recalls.id, r.id));
    await writeAudit(tx, ctx, { action: 'recall.remind', entityType: 'recall', entityId: r.id, branchId: r.branchId, after: { remindCount: r.remindCount + 1 } });
    return { remindedAt: now };
  });
}

/**
 * Open recalls due up to `horizonDays` ahead (overdue first), at the given
 * branches, or for one patient across every branch the user can see.
 */
export async function openRecalls(ctx: TenantContext, opts: { branchIds: string[]; patientId?: string; horizonDays?: number; today?: string }): Promise<RecallRow[]> {
  const today = opts.today ?? businessDate();
  const ids = opts.branchIds.filter((b) => ctx.branchIds.includes(b) && (canDo(ctx, 'recall.manage', b) || canDo(ctx, 'patient.remind', b) || canDo(ctx, 'patient.view', b)));
  if (ids.length === 0) return [];
  const conds = [eq(recalls.orgId, ctx.orgId), inArray(recalls.branchId, ids), eq(recalls.status, 'open')];
  if (opts.patientId) {
    if (!isUuid(opts.patientId)) return [];
    conds.push(eq(recalls.patientId, opts.patientId));
  }
  if (opts.horizonDays !== undefined) conds.push(lte(recalls.dueOn, addDays(today, opts.horizonDays)));
  const rows = await getDb()
    .select({ r: recalls, branchName: branches.name, branchPhone: branches.phone, patientName: patients.fullName, phone: patients.phone })
    .from(recalls)
    .innerJoin(branches, eq(branches.id, recalls.branchId))
    .innerJoin(patients, eq(patients.id, recalls.patientId))
    .where(and(...conds))
    .orderBy(asc(recalls.dueOn), asc(patients.fullName));
  return rows.map(({ r, branchName, branchPhone, patientName, phone }) => {
    const bucket = recallBucket(r.dueOn, today);
    const href =
      canDo(ctx, 'patient.remind', r.branchId) && waNumber(phone)
        ? waLink(recallReminderText({ firstName: firstName(patientName), branchName, branchPhone, overdue: bucket === 'overdue' }), phone)
        : null;
    return {
      id: r.id,
      branchId: r.branchId,
      branchName,
      patientId: r.patientId,
      patientName,
      dueOn: r.dueOn,
      kind: r.kind as RecallKind,
      bucket,
      remindCount: r.remindCount,
      lastRemindedAt: r.lastRemindedAt,
      href,
    };
  });
}
