import { and, asc, eq, gt, gte, inArray, isNull, lt, lte } from 'drizzle-orm';
import { getDb, type DB, type Tx } from '@/db/client';
import { appointments, branches, patients, providerBranches, providerLeave, providers } from '@/db/schema';
import { ACTIVE_STATUSES, istInstant } from '@/domain/appointments';
import { addDays, businessDate, istTime } from '@/domain/dates';
import { checkLeave, leaveWords, type Leave, type LeaveInput } from '@/domain/leave';
import type { FieldErrors } from '@/domain/staff';
import { writeAudit } from './audit';
import { canAnywhere, canDo, ForbiddenError, type TenantContext } from './context';
import { isUuid } from './util';

/**
 * Doctor leave (Sprint 8). Whole days at every branch. Whoever can book at a
 * branch the doctor works at can record it, because the desk is usually told
 * first; the owner can for any doctor. Existing bookings are never moved or
 * cancelled automatically: they are listed "to move" for the desk to call.
 */

export interface LeaveRow extends Leave {
  id: string;
  providerId: string;
  providerName: string;
}

export interface ToMove {
  id: string;
  leaveId: string;
  date: string;
  time: string;
  patientId: string;
  patientName: string;
  providerName: string;
  branchName: string;
}

/** Branches where this user may record leave for this doctor. */
async function manageableBranches(db: DB | Tx, ctx: TenantContext, providerId: string): Promise<string[]> {
  const rows = await db
    .select({ branchId: providerBranches.branchId })
    .from(providerBranches)
    .innerJoin(providers, eq(providers.id, providerBranches.providerId))
    .where(and(eq(providerBranches.orgId, ctx.orgId), eq(providerBranches.providerId, providerId), eq(providers.active, true)));
  return rows.map((r) => r.branchId).filter((b) => canDo(ctx, 'appointment.manage', b));
}

async function assertCanManage(db: DB | Tx, ctx: TenantContext, providerId: string) {
  if (!isUuid(providerId)) throw new ForbiddenError();
  const [p] = await db.select({ id: providers.id }).from(providers).where(and(eq(providers.id, providerId), eq(providers.orgId, ctx.orgId)));
  if (!p) throw new ForbiddenError();
  if (canAnywhere(ctx, 'provider.manage')) return;
  if ((await manageableBranches(db, ctx, providerId)).length === 0) throw new ForbiddenError();
}

/** Active (not removed) leave for these doctors overlapping [from, to]. */
export async function leavesFor(db: DB | Tx, orgId: string, providerIds: string[], from: string, to: string) {
  if (providerIds.length === 0) return [];
  return db
    .select({ id: providerLeave.id, providerId: providerLeave.providerId, startsOn: providerLeave.startsOn, endsOn: providerLeave.endsOn, note: providerLeave.note })
    .from(providerLeave)
    .where(and(eq(providerLeave.orgId, orgId), inArray(providerLeave.providerId, providerIds), isNull(providerLeave.removedAt), lte(providerLeave.startsOn, to), gte(providerLeave.endsOn, from)));
}

/** For booking: a message if the doctor is on leave on the day this starts, else null. */
export async function leaveBlocks(db: DB | Tx, ctx: TenantContext, providerId: string, startsAt: Date, providerName?: string): Promise<string | null> {
  const day = businessDate(startsAt);
  const [l] = await leavesFor(db, ctx.orgId, [providerId], day, day);
  if (!l) return null;
  return `${providerName ?? 'This doctor'} is on leave ${leaveWords(l)}. Pick another day or doctor.`;
}

export type AddLeaveResult = { ok: true; id: string; toMove: number } | { ok: false; fieldErrors: FieldErrors };

export async function addLeave(ctx: TenantContext, providerId: string, input: LeaveInput): Promise<AddLeaveResult> {
  const db = getDb();
  await assertCanManage(db, ctx, providerId);
  const checked = checkLeave(input, businessDate());
  if (!checked.ok) return checked;
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(providerLeave)
      .values({ orgId: ctx.orgId, providerId, ...checked.value, createdBy: ctx.userId })
      .returning({ id: providerLeave.id });
    await writeAudit(tx, ctx, { action: 'provider.leave_add', entityType: 'provider', entityId: providerId, after: { leaveId: row!.id, ...checked.value } });
    return row!.id;
  });
  const toMove = (await bookedDuring(db, ctx, [{ id, providerId, ...checked.value }])).length;
  return { ok: true, id, toMove };
}

export async function removeLeave(ctx: TenantContext, leaveId: string): Promise<void> {
  if (!isUuid(leaveId)) throw new ForbiddenError();
  const db = getDb();
  await db.transaction(async (tx) => {
    const [l] = await tx.select().from(providerLeave).where(and(eq(providerLeave.id, leaveId), eq(providerLeave.orgId, ctx.orgId))).for('update');
    if (!l) throw new ForbiddenError();
    await assertCanManage(tx, ctx, l.providerId);
    if (l.removedAt) return;
    await tx.update(providerLeave).set({ removedAt: new Date(), removedBy: ctx.userId }).where(eq(providerLeave.id, l.id));
    await writeAudit(tx, ctx, { action: 'provider.leave_remove', entityType: 'provider', entityId: l.providerId, before: { leaveId: l.id, startsOn: l.startsOn, endsOn: l.endsOn } });
  });
}

/** Booked or confirmed appointments that fall inside these leaves, at branches this user sees. */
async function bookedDuring(db: DB | Tx, ctx: TenantContext, leaves: (Leave & { id: string; providerId: string })[]): Promise<ToMove[]> {
  const out: ToMove[] = [];
  for (const l of leaves) {
    const rows = await db
      .select({ id: appointments.id, startsAt: appointments.startsAt, patientId: patients.id, patientName: patients.fullName, providerName: providers.fullName, branchName: branches.name })
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .innerJoin(providers, eq(providers.id, appointments.doctorId))
      .innerJoin(branches, eq(branches.id, appointments.branchId))
      .where(
        and(
          eq(appointments.orgId, ctx.orgId),
          eq(appointments.doctorId, l.providerId),
          inArray(appointments.status, ['booked', 'confirmed']),
          inArray(appointments.branchId, ctx.branchIds.length ? ctx.branchIds : ['00000000-0000-0000-0000-000000000000']),
          lt(appointments.startsAt, istInstant(addDays(l.endsOn, 1), '00:00')),
          gt(appointments.endsAt, istInstant(l.startsOn, '00:00')),
        ),
      )
      .orderBy(asc(appointments.startsAt));
    for (const r of rows) out.push({ id: r.id, leaveId: l.id, date: businessDate(r.startsAt), time: istTime(r.startsAt), patientId: r.patientId, patientName: r.patientName, providerName: r.providerName, branchName: r.branchName });
  }
  return out;
}

/**
 * The Doctor leave page: doctors this user can record leave for, leave that
 * hasn't ended yet, and the appointments inside it still to move.
 */
export async function leavePage(ctx: TenantContext): Promise<{ doctors: { id: string; name: string }[]; leaves: (LeaveRow & { canRemove: boolean })[]; toMove: ToMove[] }> {
  const db = getDb();
  const owner = canAnywhere(ctx, 'provider.manage');
  const docs = await db
    .selectDistinct({ id: providers.id, name: providers.fullName, branchId: providerBranches.branchId })
    .from(providers)
    .innerJoin(providerBranches, eq(providerBranches.providerId, providers.id))
    .where(and(eq(providers.orgId, ctx.orgId), eq(providers.active, true)))
    .orderBy(asc(providers.fullName));
  const mine = new Map<string, string>();
  for (const d of docs) if (owner || canDo(ctx, 'appointment.manage', d.branchId)) mine.set(d.id, d.name);
  const doctors = [...mine].map(([id, name]) => ({ id, name }));
  const today = businessDate();
  const rows = await leavesFor(db, ctx.orgId, [...mine.keys()], today, '9999-12-31');
  const leaves = rows
    .map((l) => ({ ...l, providerName: mine.get(l.providerId)!, canRemove: true }))
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.providerName.localeCompare(b.providerName));
  // Only from today on: yesterday's bookings are no-shows or done, not "to move".
  const toMove = await bookedDuring(db, ctx, leaves.map((l) => ({ ...l, startsOn: l.startsOn < today ? today : l.startsOn })));
  return { doctors, leaves, toMove };
}
