'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getContext } from '@/lib/auth';
import { bookAppointment, doctorDays, markArrived, rescheduleAppointment, setAppointmentStatus, type BookResult, type DoctorDay } from '@/services/appointments';
import { canDo, ForbiddenError, requireActiveBranch } from '@/services/context';
import { addLeave, removeLeave, type AddLeaveResult } from '@/services/leave';
import { run, signedOut, type ActionResult } from './run';

/** Appointments (Sprint 4, LET-167). Thin: parse, then the service checks capability, branch and overlap. */

const id = z.string().uuid();
const booking = z.object({
  providerId: z.string().max(40),
  date: z.string().max(10),
  time: z.string().max(5),
  minutes: z.number().int().min(0).max(240),
  reason: z.string().max(200),
});

function parse<T>(schema: z.ZodType<T>, v: unknown): T {
  const r = schema.safeParse(v);
  if (!r.success) throw new ForbiddenError();
  return r.data;
}

function refresh() {
  revalidatePath('/', 'layout');
}

export async function bookAppointmentAction(patientId: string, input: z.input<typeof booking>): Promise<ActionResult<BookResult>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('appointment.book');
  const res = await run('appointment.book', () => bookAppointment(ctx, { patientId: parse(id, patientId), ...parse(booking, input) }));
  if (res.ok && res.data.ok) refresh();
  return res;
}

export async function rescheduleAppointmentAction(appointmentId: string, input: z.input<typeof booking>): Promise<ActionResult<BookResult>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('appointment.move');
  const res = await run('appointment.move', () => rescheduleAppointment(ctx, parse(id, appointmentId), parse(booking, input)));
  if (res.ok && res.data.ok) refresh();
  return res;
}

const statusInput = z.enum(['booked', 'confirmed', 'no_show', 'cancelled']);

export async function setAppointmentStatusAction(appointmentId: string, to: string, reason = ''): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx) return signedOut('appointment.status');
  const res = await run('appointment.status', async () => {
    await setAppointmentStatus(ctx, parse(id, appointmentId), parse(statusInput, to), parse(z.string().max(200), reason));
    return undefined;
  });
  if (res.ok) refresh();
  return res;
}

export async function markArrivedAction(appointmentId: string): Promise<ActionResult<{ token: number | null }>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('appointment.arrived');
  const res = await run('appointment.arrived', () => markArrived(ctx, parse(id, appointmentId)));
  if (res.ok) refresh();
  return res;
}

/** Free slots for every doctor at the active branch on a date: the booking form asks for these when the date changes. */
export async function doctorDaysAction(date: string): Promise<ActionResult<DoctorDay[]>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('appointment.slots');
  return run('appointment.slots', async () => {
    const branchId = requireActiveBranch(ctx);
    if (!canDo(ctx, 'appointment.manage', branchId)) throw new ForbiddenError();
    const d = parse(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), date);
    return doctorDays(ctx, branchId, d);
  });
}

const leaveInput = z.object({ from: z.string().max(10), to: z.string().max(10), note: z.string().max(400) });

/** Doctor leave (Sprint 8). The service checks who may record it. */
export async function addLeaveAction(providerId: string, input: z.input<typeof leaveInput>): Promise<ActionResult<AddLeaveResult>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('provider.leave_add');
  const res = await run('provider.leave_add', () => addLeave(ctx, parse(id, providerId), parse(leaveInput, input)));
  if (res.ok && res.data.ok) refresh();
  return res;
}

export async function removeLeaveAction(leaveId: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx) return signedOut('provider.leave_remove');
  const res = await run('provider.leave_remove', async () => {
    await removeLeave(ctx, parse(id, leaveId));
    return undefined;
  });
  if (res.ok) refresh();
  return res;
}
