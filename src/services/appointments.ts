import { and, asc, eq, gt, gte, inArray, lt, ne } from 'drizzle-orm';
import { getDb, type Tx } from '@/db/client';
import { appointments, branches, patients, providerBranches, providers, recalls } from '@/db/schema';
import {
  ACTIVE_STATUSES,
  canMoveAppointment,
  checkBooking,
  freeSlots,
  isoWeekday,
  istInstant,
  type AppointmentStatus,
  type BookingInput,
} from '@/domain/appointments';
import { addDays, businessDate, istTime } from '@/domain/dates';
import { minutesOf } from '@/domain/providers';
import type { FieldErrors } from '@/domain/staff';
import { writeAudit } from './audit';
import { canDo, ForbiddenError, requireActiveBranch, UserFacingError, type TenantContext } from './context';
import { hashCalendarToken, providerAtBranch } from './providers';
import { isUuid } from './util';
import { addToQueue } from './visits';

/**
 * Appointments (Sprint 4, LET-167). Booked at the active branch for a doctor
 * who works there. No double-booking: Postgres refuses overlapping active
 * appointments for one doctor (appointments_no_overlap, migration 0008), so
 * two desks booking the same slot at once can't both win. Every change is
 * audited; the reason is shown in Chairside only.
 */

export interface AppointmentRow {
  id: string;
  branchId: string;
  patientId: string;
  patientName: string;
  patientPhone: string;
  providerId: string;
  providerName: string;
  colour: string | null;
  startsAt: Date;
  endsAt: Date;
  /** "11:00" IST. */
  time: string;
  minutes: number;
  status: AppointmentStatus;
  reason: string | null;
}

const EXCLUSION = '23P01';
function isOverlap(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === EXCLUSION || e?.cause?.code === EXCLUSION;
}

function assertBook(ctx: TenantContext, branchId: string) {
  if (!canDo(ctx, 'appointment.manage', branchId)) throw new ForbiddenError();
}

async function overlapMessage(tx: Tx | ReturnType<typeof getDb>, providerId: string, startsAt: Date, endsAt: Date, exceptId?: string): Promise<string> {
  const [clash] = await tx
    .select({ startsAt: appointments.startsAt, endsAt: appointments.endsAt, name: providers.fullName })
    .from(appointments)
    .innerJoin(providers, eq(providers.id, appointments.doctorId))
    .where(
      and(
        eq(appointments.doctorId, providerId),
        inArray(appointments.status, [...ACTIVE_STATUSES]),
        lt(appointments.startsAt, endsAt),
        gt(appointments.endsAt, startsAt),
        exceptId ? ne(appointments.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return clash ? `${clash.name} already has someone from ${istTime(clash.startsAt)} to ${istTime(clash.endsAt)}. Pick another time.` : 'That doctor is already booked then. Pick another time.';
}

export type BookResult = { ok: true; id: string } | { ok: false; fieldErrors: FieldErrors };

export interface BookInput extends BookingInput {
  patientId: string;
  providerId: string;
}

/** Book at the active branch. The length defaults to the doctor's slot. */
export async function bookAppointment(ctx: TenantContext, input: BookInput): Promise<BookResult> {
  const branchId = requireActiveBranch(ctx);
  assertBook(ctx, branchId);
  if (!isUuid(input.patientId)) throw new ForbiddenError();
  const db = getDb();
  const provider = await providerAtBranch(db, ctx, input.providerId, branchId);
  if (!provider) return { ok: false, fieldErrors: { providerId: 'Pick a doctor who works at this branch.' } };
  const checked = checkBooking({ ...input, minutes: input.minutes || provider.slotMinutes }, businessDate());
  if (!checked.ok) return checked;
  const [p] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, input.patientId), eq(patients.orgId, ctx.orgId))).limit(1);
  if (!p) throw new ForbiddenError();
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(appointments)
        .values({ orgId: ctx.orgId, branchId, patientId: p.id, doctorId: provider.id, startsAt: checked.value.startsAt, endsAt: checked.value.endsAt, reason: checked.value.reason, createdBy: ctx.userId })
        .returning({ id: appointments.id });
      await writeAudit(tx, ctx, { action: 'appointment.book', entityType: 'appointment', entityId: row!.id, branchId, after: { providerId: provider.id, startsAt: checked.value.startsAt, endsAt: checked.value.endsAt } });
      // A booked time answers "come back for a check-up": close this patient's
      // open reminders at this branch, so Recalls doesn't chase them (QA 9 Nov).
      const open = await tx
        .select({ id: recalls.id })
        .from(recalls)
        .where(and(eq(recalls.orgId, ctx.orgId), eq(recalls.branchId, branchId), eq(recalls.patientId, p.id), eq(recalls.status, 'open')))
        .for('update');
      for (const r of open) {
        await tx.update(recalls).set({ status: 'done', closedBy: ctx.userId, closedAt: new Date() }).where(eq(recalls.id, r.id));
        await writeAudit(tx, ctx, { action: 'recall.close', entityType: 'recall', entityId: r.id, branchId, before: { status: 'open' }, after: { status: 'done', byAppointment: row!.id } });
      }
      return { ok: true as const, id: row!.id };
    });
  } catch (err) {
    if (isOverlap(err)) return { ok: false, fieldErrors: { time: await overlapMessage(db, provider.id, checked.value.startsAt, checked.value.endsAt) } };
    throw err;
  }
}

async function lockAppointment(tx: Tx, ctx: TenantContext, id: string) {
  if (!isUuid(id)) throw new ForbiddenError();
  const [a] = await tx.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.orgId, ctx.orgId))).for('update');
  if (!a) throw new ForbiddenError();
  assertBook(ctx, a.branchId);
  return a;
}

/** Move to another time and/or doctor (same branch). Only booked or confirmed appointments move. */
export async function rescheduleAppointment(ctx: TenantContext, id: string, input: BookingInput & { providerId: string }): Promise<BookResult> {
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      const a = await lockAppointment(tx, ctx, id);
      if (a.status !== 'booked' && a.status !== 'confirmed') throw new UserFacingError('Only a booked appointment can be moved.');
      const provider = await providerAtBranch(tx, ctx, input.providerId, a.branchId);
      if (!provider) return { ok: false as const, fieldErrors: { providerId: 'Pick a doctor who works at this branch.' } };
      const checked = checkBooking({ ...input, minutes: input.minutes || provider.slotMinutes }, businessDate());
      if (!checked.ok) return checked;
      await tx
        .update(appointments)
        .set({ doctorId: provider.id, startsAt: checked.value.startsAt, endsAt: checked.value.endsAt, reason: checked.value.reason, status: 'booked', updatedAt: new Date() })
        .where(and(eq(appointments.id, a.id), eq(appointments.orgId, ctx.orgId)));
      await writeAudit(tx, ctx, {
        action: 'appointment.move',
        entityType: 'appointment',
        entityId: a.id,
        branchId: a.branchId,
        before: { providerId: a.doctorId, startsAt: a.startsAt, endsAt: a.endsAt },
        after: { providerId: provider.id, startsAt: checked.value.startsAt, endsAt: checked.value.endsAt },
      });
      return { ok: true as const, id: a.id };
    });
  } catch (err) {
    if (isOverlap(err)) {
      const checked = checkBooking(input, businessDate());
      return { ok: false, fieldErrors: { time: checked.ok ? await overlapMessage(db, input.providerId, checked.value.startsAt, checked.value.endsAt, id) : 'That doctor is already booked then.' } };
    }
    throw err;
  }
}

/**
 * Confirm, no-show, cancel (with a reason), or undo. "Arrived" goes through
 * markArrived, which also puts the patient in the waiting room.
 */
export async function setAppointmentStatus(ctx: TenantContext, id: string, to: AppointmentStatus, reason?: string): Promise<void> {
  if (to === 'arrived') throw new UserFacingError('Use Arrived to add them to the waiting room.');
  const why = (reason ?? '').trim().replace(/\s+/g, ' ');
  if (to === 'cancelled' && why.length < 3) throw new UserFacingError('Say why it was cancelled (at least 3 characters).');
  if (why.length > 120) throw new UserFacingError('Keep the reason under 120 characters.');
  try {
    await getDb().transaction(async (tx) => {
      const a = await lockAppointment(tx, ctx, id);
      if (a.status === to) return;
      if (!canMoveAppointment(a.status as AppointmentStatus, to)) throw new UserFacingError(`A ${a.status.replace('_', '-')} appointment can't be marked ${to.replace('_', '-')}.`);
      await tx
        .update(appointments)
        .set({ status: to, cancelReason: to === 'cancelled' ? why : a.cancelReason, updatedAt: new Date() })
        .where(and(eq(appointments.id, a.id), eq(appointments.orgId, ctx.orgId)));
      await writeAudit(tx, ctx, { action: `appointment.${to}`, entityType: 'appointment', entityId: a.id, branchId: a.branchId, before: { status: a.status }, after: { status: to, reason: why || undefined } });
    });
  } catch (err) {
    // Undoing a no-show into a slot someone else has since taken.
    if (isOverlap(err)) throw new UserFacingError('That time has been booked for someone else since. Book a new time instead.');
    throw err;
  }
}

/** The patient is here: mark arrived and add them to today's waiting room. */
export async function markArrived(ctx: TenantContext, id: string): Promise<{ token: number | null }> {
  const db = getDb();
  const [a] = await db.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.orgId, ctx.orgId))).limit(1);
  if (!a || !isUuid(id)) throw new ForbiddenError();
  assertBook(ctx, a.branchId);
  if (ctx.activeBranchId !== a.branchId) throw new UserFacingError('Switch to this appointment’s branch first.');
  if (businessDate(a.startsAt) !== businessDate()) throw new UserFacingError('Only today’s appointments can be marked arrived.');
  if (!canMoveAppointment(a.status as AppointmentStatus, 'arrived')) throw new UserFacingError('This appointment can’t be marked arrived.');
  let token: number | null = null;
  try {
    token = (await addToQueue(ctx, a.patientId, a.id)).token;
  } catch (err) {
    // Already in the queue as a walk-in: keep that token.
    if (!(err instanceof UserFacingError)) throw err;
  }
  await db.transaction(async (tx) => {
    const locked = await lockAppointment(tx, ctx, id);
    if (locked.status === 'arrived') return;
    await tx.update(appointments).set({ status: 'arrived', updatedAt: new Date() }).where(and(eq(appointments.id, locked.id), eq(appointments.orgId, ctx.orgId)));
    await writeAudit(tx, ctx, { action: 'appointment.arrived', entityType: 'appointment', entityId: locked.id, branchId: locked.branchId, before: { status: locked.status }, after: { status: 'arrived', token } });
  });
  return { token };
}

const rowSelect = {
  id: appointments.id,
  branchId: appointments.branchId,
  patientId: appointments.patientId,
  patientName: patients.fullName,
  patientPhone: patients.phone,
  providerId: appointments.doctorId,
  providerName: providers.fullName,
  colour: providers.colour,
  startsAt: appointments.startsAt,
  endsAt: appointments.endsAt,
  status: appointments.status,
  reason: appointments.reason,
};

function toRow(r: Omit<AppointmentRow, 'time' | 'minutes'>): AppointmentRow {
  return { ...r, status: r.status as AppointmentStatus, time: istTime(r.startsAt), minutes: Math.round((r.endsAt.getTime() - r.startsAt.getTime()) / 60_000) };
}

/** One clinic day at the given branches, in time order. Includes cancelled and no-shows. */
export async function dayAppointments(ctx: TenantContext, branchIds: string[], date: string): Promise<AppointmentRow[]> {
  const ids = branchIds.filter((b) => canDo(ctx, 'appointment.manage', b) || canDo(ctx, 'report.branch', b));
  if (ids.length === 0) return [];
  const rows = await getDb()
    .select(rowSelect)
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(providers, eq(providers.id, appointments.doctorId))
    .where(and(eq(appointments.orgId, ctx.orgId), inArray(appointments.branchId, ids), gte(appointments.startsAt, istInstant(date, '00:00')), lt(appointments.startsAt, istInstant(addDays(date, 1), '00:00'))))
    .orderBy(asc(appointments.startsAt), asc(providers.fullName));
  return rows.map(toRow);
}

/** A patient's appointments from today on (any branch the user can see), soonest first. */
export async function upcomingForPatient(ctx: TenantContext, patientId: string): Promise<(AppointmentRow & { date: string; branchName: string })[]> {
  if (!isUuid(patientId)) return [];
  const rows = await getDb()
    .select({ ...rowSelect, branchName: branches.name })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(providers, eq(providers.id, appointments.doctorId))
    .innerJoin(branches, eq(branches.id, appointments.branchId))
    .where(and(eq(appointments.orgId, ctx.orgId), eq(appointments.patientId, patientId), inArray(appointments.branchId, ctx.branchIds), gte(appointments.startsAt, istInstant(businessDate(), '00:00')), inArray(appointments.status, [...ACTIVE_STATUSES])))
    .orderBy(asc(appointments.startsAt))
    .limit(10);
  return rows.map((r) => ({ ...toRow(r), date: businessDate(r.startsAt), branchName: r.branchName }));
}

export interface DoctorDay {
  providerId: string;
  name: string;
  colour: string | null;
  slotMinutes: number;
  /** Null when the doctor doesn't work at this branch that weekday. */
  hours: { startTime: string; endTime: string } | null;
  free: string[];
}

/** Each doctor at the branch on a date: their hours and free slots (past slots hidden today). */
export async function doctorDays(ctx: TenantContext, branchId: string, date: string): Promise<DoctorDay[]> {
  if (!ctx.branchIds.includes(branchId)) return [];
  const db = getDb();
  const docs = await db
    .select({ id: providers.id, name: providers.fullName, colour: providers.colour, slotMinutes: providers.slotMinutes, days: providerBranches.days, startTime: providerBranches.startTime, endTime: providerBranches.endTime })
    .from(providers)
    .innerJoin(providerBranches, eq(providerBranches.providerId, providers.id))
    .where(and(eq(providers.orgId, ctx.orgId), eq(providers.active, true), eq(providerBranches.branchId, branchId)))
    .orderBy(asc(providers.fullName));
  if (docs.length === 0) return [];
  // A doctor's other bookings that day, at any branch, block their time.
  const booked = await db
    .select({ providerId: appointments.doctorId, startsAt: appointments.startsAt, endsAt: appointments.endsAt })
    .from(appointments)
    .where(and(eq(appointments.orgId, ctx.orgId), inArray(appointments.doctorId, docs.map((d) => d.id)), inArray(appointments.status, [...ACTIVE_STATUSES]), gt(appointments.endsAt, istInstant(date, '00:00')), lt(appointments.startsAt, istInstant(addDays(date, 1), '00:00'))));
  const weekday = isoWeekday(date);
  const today = businessDate();
  const nowMin = date === today ? (minutesOf(istTime(new Date())) ?? 0) : undefined;
  const minutesIn = (d: Date) => {
    const day = businessDate(d);
    if (day < date) return 0;
    if (day > date) return 24 * 60;
    return minutesOf(istTime(d)) ?? 0;
  };
  return docs.map((d) => {
    const works = (d.days as number[]).includes(weekday);
    const busy = booked.filter((b) => b.providerId === d.id).map((b) => ({ start: minutesIn(b.startsAt), end: minutesIn(b.endsAt) }));
    return {
      providerId: d.id,
      name: d.name,
      colour: d.colour,
      slotMinutes: d.slotMinutes,
      hours: works ? { startTime: d.startTime, endTime: d.endTime } : null,
      free: works && date >= today ? freeSlots({ startTime: d.startTime, endTime: d.endTime, slotMinutes: d.slotMinutes, busy, after: nowMin }) : [],
    };
  });
}

/** Today's counts for the dashboard and the owner's summary (LET-171). */
export async function appointmentCounts(ctx: TenantContext, branchIds: string[], date: string) {
  const rows = await dayAppointments(ctx, branchIds, date);
  const count = (s: AppointmentStatus[]) => rows.filter((r) => s.includes(r.status)).length;
  return {
    total: rows.filter((r) => r.status !== 'cancelled').length,
    waitingToArrive: count(['booked', 'confirmed']),
    arrived: count(['arrived', 'in_chair', 'completed']),
    noShow: count(['no_show']),
    cancelled: count(['cancelled']),
    byDoctor: [...new Set(rows.filter((r) => r.status !== 'cancelled').map((r) => r.providerName))].map((name) => ({
      name,
      booked: rows.filter((r) => r.providerName === name && r.status !== 'cancelled').length,
      seen: rows.filter((r) => r.providerName === name && ['arrived', 'in_chair', 'completed'].includes(r.status)).length,
      noShow: rows.filter((r) => r.providerName === name && r.status === 'no_show').length,
    })),
  };
}

/** One appointment the user can manage, for the Move screen. */
export async function getAppointment(ctx: TenantContext, id: string): Promise<(AppointmentRow & { date: string }) | null> {
  if (!isUuid(id)) return null;
  const [r] = await getDb()
    .select(rowSelect)
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(providers, eq(providers.id, appointments.doctorId))
    .where(and(eq(appointments.id, id), eq(appointments.orgId, ctx.orgId), inArray(appointments.branchId, ctx.branchIds)))
    .limit(1);
  return r ? { ...toRow(r), date: businessDate(r.startsAt) } : null;
}

/**
 * The private calendar feed for one doctor (LET-170). The link token is the
 * only credential, so it is looked up by hash and nothing else about the
 * request is trusted. Times and branch only: no patient names or reasons.
 * Two weeks back to three months ahead; cancelled and no-shows drop out.
 */
export async function calendarFeed(token: string): Promise<{ name: string; events: { uid: string; start: Date; end: Date; summary: string; location: string }[] } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const db = getDb();
  const [p] = await db
    .select({ id: providers.id, orgId: providers.orgId, name: providers.fullName })
    .from(providers)
    .where(and(eq(providers.calendarTokenHash, hashCalendarToken(token)), eq(providers.active, true)))
    .limit(1);
  if (!p) return null;
  const now = Date.now();
  const rows = await db
    .select({ id: appointments.id, startsAt: appointments.startsAt, endsAt: appointments.endsAt, branch: branches.name })
    .from(appointments)
    .innerJoin(branches, eq(branches.id, appointments.branchId))
    .where(
      and(
        eq(appointments.orgId, p.orgId),
        eq(appointments.doctorId, p.id),
        inArray(appointments.status, [...ACTIVE_STATUSES, 'completed']),
        gte(appointments.startsAt, new Date(now - 14 * 86_400_000)),
        lt(appointments.startsAt, new Date(now + 92 * 86_400_000)),
      ),
    )
    .orderBy(asc(appointments.startsAt))
    .limit(2000);
  return {
    name: p.name,
    events: rows.map((r) => ({ uid: `${r.id}@chairside`, start: r.startsAt, end: r.endsAt, summary: `Appointment · ${Math.round((r.endsAt.getTime() - r.startsAt.getTime()) / 60_000)} min`, location: r.branch })),
  };
}
