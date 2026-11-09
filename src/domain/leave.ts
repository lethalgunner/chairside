import { addDays, isIsoDate, shortDay } from './dates';
import type { FieldErrors } from './staff';

/**
 * Doctor leave (Sprint 8). Whole days, both ends included. Pure rules only;
 * the service stores it and the booking checks read it.
 */

export const MAX_LEAVE_DAYS = 180;

export interface LeaveInput {
  from: string;
  to: string;
  note?: string;
}

export interface Leave {
  startsOn: string;
  endsOn: string;
  note: string | null;
}

export type LeaveCheck = { ok: true; value: Leave } | { ok: false; fieldErrors: FieldErrors };

export function checkLeave(input: LeaveInput, today: string): LeaveCheck {
  const errors: FieldErrors = {};
  const from = (input.from ?? '').trim();
  const to = (input.to ?? '').trim() || from;
  const note = (input.note ?? '').trim();
  if (!isIsoDate(from)) errors.from = 'Pick the first day away.';
  else if (from < today) errors.from = 'Leave can start today or later.';
  if (!isIsoDate(to)) errors.to = 'Pick the last day away.';
  else if (isIsoDate(from) && to < from) errors.to = 'The last day can’t be before the first.';
  else if (isIsoDate(from) && to > addDays(from, MAX_LEAVE_DAYS - 1)) errors.to = `Up to ${MAX_LEAVE_DAYS} days at a time.`;
  if (note.length > 200) errors.note = 'Keep the note under 200 characters.';
  if (Object.keys(errors).length) return { ok: false, fieldErrors: errors };
  return { ok: true, value: { startsOn: from, endsOn: to, note: note || null } };
}

/** The leave covering a day, if any. */
export function leaveOn<T extends Leave>(leaves: readonly T[], date: string): T | null {
  return leaves.find((l) => l.startsOn <= date && date <= l.endsOn) ?? null;
}

/** "Mon 9 Nov" or "Mon 9 Nov to Fri 13 Nov". */
export function leaveWords(l: Leave): string {
  return l.startsOn === l.endsOn ? shortDay(l.startsOn) : `${shortDay(l.startsOn)} to ${shortDay(l.endsOn)}`;
}
