/**
 * Appointments (Sprint 4, LET-167). Pure rules: IST times, free slots, the
 * booking check and status moves. Stored as timestamptz (UTC); clinics see IST.
 */
import { minutesOf } from './providers';
import type { Checked, FieldErrors } from './staff';

export type AppointmentStatus = 'booked' | 'confirmed' | 'arrived' | 'in_chair' | 'completed' | 'no_show' | 'cancelled';
/** Statuses that hold the doctor's time (the database refuses overlaps among these). */
export const ACTIVE_STATUSES: readonly AppointmentStatus[] = ['booked', 'confirmed', 'arrived', 'in_chair'];
export const APPOINTMENT_LABEL: Record<AppointmentStatus, string> = {
  booked: 'Booked',
  confirmed: 'Confirmed',
  arrived: 'Arrived',
  in_chair: 'In chair',
  completed: 'Done',
  no_show: 'No-show',
  cancelled: 'Cancelled',
};

/** The instant for a clinic date and "HH:MM" in IST (no daylight saving in India). */
export function istInstant(date: string, hhmm: string): Date {
  return new Date(`${date}T${hhmm}:00+05:30`);
}

/** "HH:MM" for minutes after midnight. */
export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** ISO weekday (1 = Monday) of a YYYY-MM-DD date. */
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export interface BusyRange {
  /** Minutes after midnight, IST. */
  start: number;
  end: number;
}

/**
 * Free slot starts for one doctor on one day: every slot inside working hours
 * that overlaps nothing booked. `after` hides slots that have already started
 * (today), in minutes after midnight.
 */
export function freeSlots(opts: { startTime: string; endTime: string; slotMinutes: number; busy: BusyRange[]; after?: number }): string[] {
  const start = minutesOf(opts.startTime);
  const end = minutesOf(opts.endTime);
  if (start === null || end === null || opts.slotMinutes <= 0) return [];
  const out: string[] = [];
  for (let t = start; t + opts.slotMinutes <= end; t += opts.slotMinutes) {
    if (opts.after !== undefined && t < opts.after) continue;
    if (opts.busy.some((b) => t < b.end && b.start < t + opts.slotMinutes)) continue;
    out.push(hhmm(t));
  }
  return out;
}

export interface BookingInput {
  date: string;
  time: string;
  minutes: number;
  reason: string;
}

export interface BookingValues {
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
}

/**
 * Check a booking. Today or later only; 5-minute steps; up to 4 hours. The
 * reason is plain words for the desk ("Check-up", "RCT sitting 2") and never
 * leaves Chairside (not in the calendar feed or WhatsApp).
 */
export function checkBooking(input: BookingInput, today: string): Checked<BookingValues> {
  const fieldErrors: FieldErrors = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(`${input.date}T00:00:00Z`))) fieldErrors.date = 'Pick a date.';
  else if (input.date < today) fieldErrors.date = 'Pick today or a later date.';
  const t = minutesOf(input.time);
  if (t === null) fieldErrors.time = 'Pick a time, like 11:00.';
  else if (t % 5 !== 0) fieldErrors.time = 'Times go in 5-minute steps.';
  if (!Number.isInteger(input.minutes) || input.minutes < 5 || input.minutes > 240 || input.minutes % 5 !== 0) fieldErrors.minutes = 'Length is 5 to 240 minutes, in 5-minute steps.';
  const reason = input.reason.trim().replace(/\s+/g, ' ');
  if (reason.length > 80) fieldErrors.reason = 'Keep the reason under 80 characters.';
  if (Object.keys(fieldErrors).length > 0 || t === null) return { ok: false, fieldErrors };
  const startsAt = istInstant(input.date, input.time);
  return { ok: true, value: { startsAt, endsAt: new Date(startsAt.getTime() + input.minutes * 60_000), reason: reason || null } };
}

const MOVES: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  booked: ['confirmed', 'arrived', 'no_show', 'cancelled'],
  confirmed: ['arrived', 'no_show', 'cancelled', 'booked'],
  arrived: ['completed', 'booked'],
  in_chair: ['completed'],
  completed: [],
  no_show: ['booked'],
  cancelled: [],
};

/** Allowed status changes. Arrived → Booked and No-show → Booked undo a mistaken tap. */
export function canMoveAppointment(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return MOVES[from].includes(to);
}
