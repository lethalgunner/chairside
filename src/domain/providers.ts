/**
 * Doctor profiles (Sprint 4, LET-166, ADR-008). Pure rules, unit-tested; the
 * Settings → Doctors screen and the service both use them.
 */
import type { Checked, FieldErrors } from './staff';

export const ENGAGEMENT_TYPES = ['owner_partner', 'salaried', 'associate', 'visiting'] as const;
export type EngagementType = (typeof ENGAGEMENT_TYPES)[number];
export const ENGAGEMENT_LABEL: Record<EngagementType, string> = {
  owner_partner: 'Owner or partner',
  salaried: 'Salaried',
  associate: 'Associate (paid per case)',
  visiting: 'Visiting specialist',
};
export const SLOT_MINUTES = [10, 15, 20, 30] as const;
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
/** A small fixed palette so colours stay readable on the calendar in both themes. */
export const PROVIDER_COLOURS = ['#0f766e', '#1d4ed8', '#7c3aed', '#b45309', '#be123c', '#4d7c0f', '#0e7490', '#6b7280'] as const;

export interface ProviderInput {
  fullName: string;
  qualification: string;
  registrationNumber: string;
  registrationCouncil: string;
  specialty: string;
  engagementType: string;
  colour: string;
  slotMinutes: number;
}

export interface ProviderValues {
  fullName: string;
  qualification: string | null;
  registrationNumber: string | null;
  registrationCouncil: string | null;
  specialty: string | null;
  engagementType: EngagementType;
  colour: string | null;
  slotMinutes: number;
}

const tidy = (s: string) => s.trim().replace(/\s+/g, ' ');
const opt = (s: string, max: number, field: string, errors: FieldErrors, label: string): string | null => {
  const v = tidy(s);
  if (v.length > max) errors[field] = `Keep ${label} under ${max} characters.`;
  return v || null;
};

export function checkProvider(input: ProviderInput): Checked<ProviderValues> {
  const fieldErrors: FieldErrors = {};
  const fullName = tidy(input.fullName);
  if (fullName.length < 2 || fullName.length > 80) fieldErrors.fullName = 'Enter the name as it should print, like Dr. Anshul Vij (2 to 80 characters).';
  const qualification = opt(input.qualification, 80, 'qualification', fieldErrors, 'the qualification');
  const registrationNumber = opt(input.registrationNumber, 30, 'registrationNumber', fieldErrors, 'the registration number');
  if (registrationNumber && !/^[A-Za-z0-9/ .-]+$/.test(registrationNumber)) fieldErrors.registrationNumber = 'Use letters, digits, / . or - only, as on the certificate.';
  const registrationCouncil = opt(input.registrationCouncil, 60, 'registrationCouncil', fieldErrors, 'the council name');
  const specialty = opt(input.specialty, 60, 'specialty', fieldErrors, 'the specialty');
  const engagementType = ENGAGEMENT_TYPES.find((e) => e === input.engagementType);
  if (!engagementType) fieldErrors.engagementType = 'Pick how this doctor works with the clinic.';
  const colour = input.colour ? input.colour.toLowerCase() : '';
  if (colour && !(PROVIDER_COLOURS as readonly string[]).includes(colour)) fieldErrors.colour = 'Pick one of the colours shown.';
  if (!(SLOT_MINUTES as readonly number[]).includes(input.slotMinutes)) fieldErrors.slotMinutes = 'Slot length is 10, 15, 20 or 30 minutes.';
  if (Object.keys(fieldErrors).length > 0 || !engagementType) return { ok: false, fieldErrors };
  return { ok: true, value: { fullName, qualification, registrationNumber, registrationCouncil, specialty, engagementType, colour: colour || null, slotMinutes: input.slotMinutes } };
}

export interface HoursInput {
  days: number[];
  startTime: string;
  endTime: string;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes after midnight for "HH:MM", or null. */
export function minutesOf(hhmm: string): number | null {
  const m = HHMM.exec(hhmm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function checkHours(input: HoursInput): Checked<HoursInput> {
  const fieldErrors: FieldErrors = {};
  const days = [...new Set(input.days)].filter((d) => (WEEKDAYS as readonly number[]).includes(d)).sort();
  if (days.length === 0 || days.length !== new Set(input.days).size) fieldErrors.days = 'Pick at least one working day.';
  const start = minutesOf(input.startTime);
  const end = minutesOf(input.endTime);
  if (start === null) fieldErrors.startTime = 'Use a time like 10:00.';
  if (end === null) fieldErrors.endTime = 'Use a time like 19:00.';
  if (start !== null && end !== null && end - start < 60) fieldErrors.endTime = 'The day must end at least an hour after it starts.';
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, value: { days, startTime: input.startTime.trim(), endTime: input.endTime.trim() } };
}

/** "Mon–Sat, 10:00–19:00" style summary for lists. */
export function hoursLabel(h: HoursInput): string {
  const d = [...h.days].sort();
  const consecutive = d.every((x, i) => i === 0 || x === d[i - 1]! + 1);
  const days = d.length > 2 && consecutive ? `${WEEKDAY_SHORT[d[0]! - 1]}–${WEEKDAY_SHORT[d[d.length - 1]! - 1]}` : d.map((x) => WEEKDAY_SHORT[x - 1]).join(', ');
  return `${days}, ${h.startTime}–${h.endTime}`;
}
