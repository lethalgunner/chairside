import { istInstant } from './appointments';
import { addDays, businessDate, istTime } from './dates';
import type { FieldErrors } from './staff';
import { minutesOf } from './providers';

/**
 * Reminders your way (Sprint 8, ADR-020). A clinic writes its own rules and
 * wording; Chairside works out what is due and the desk sends it from the
 * clinic's own WhatsApp ("Today's messages", Mode 1). Pure functions only:
 * the service loads appointments, visits, come-backs and dues and asks the
 * planner what is due. Nothing is stored ahead of time, so a moved
 * appointment re-plans itself and a cancelled one drops its reminders.
 *
 * No clinical detail ever goes in a message (CLAUDE.md): there is no
 * treatment or reason variable, and the doctor's name only if the owner
 * switches it on.
 */

export type Trigger = 'booked' | 'before_appointment' | 'no_show' | 'after_visit' | 'recall_due' | 'dues';
export const TRIGGERS: readonly Trigger[] = ['booked', 'before_appointment', 'no_show', 'after_visit', 'recall_due', 'dues'];
export const TRIGGER_LABEL: Record<Trigger, string> = {
  booked: 'Right after booking',
  before_appointment: 'Before the appointment',
  no_show: 'After a missed appointment',
  after_visit: 'After a visit',
  recall_due: 'When a come-back is due',
  dues: 'Money owed',
};
export const APPOINTMENT_TRIGGERS: readonly Trigger[] = ['booked', 'before_appointment', 'no_show'];
export function isTrigger(v: string): v is Trigger {
  return (TRIGGERS as readonly string[]).includes(v);
}

/** At most this many reminders per appointment (booking plus before), so no patient is spammed. */
export const MAX_PER_APPOINTMENT = 6;
/** Day-based messages (after a visit, come-back, dues) are planned for this time, then quiet hours apply. */
export const DAY_SEND_TIME = '10:00';

export const VARIABLES = ['first_name', 'clinic', 'branch', 'date', 'time', 'address', 'phone', 'calendar_link', 'amount_due', 'upi_id', 'doctor'] as const;
export type Variable = (typeof VARIABLES)[number];
export const VARIABLE_HELP: Record<Variable, string> = {
  first_name: 'Patient’s first name',
  clinic: 'Clinic name',
  branch: 'Branch name',
  date: 'Appointment or come-back date, like Mon 9 Nov',
  time: 'Appointment time, like 11:00',
  address: 'Branch address',
  phone: 'Branch phone',
  calendar_link: 'Add-to-calendar link',
  amount_due: 'Amount owed, like ₹4,500.00',
  upi_id: 'Branch UPI ID',
  doctor: 'Doctor’s name (only if switched on)',
};
const COMMON: readonly Variable[] = ['first_name', 'clinic', 'branch', 'address', 'phone'];
/** Which details exist for each kind of message. */
export const TRIGGER_VARIABLES: Record<Trigger, readonly Variable[]> = {
  booked: [...COMMON, 'date', 'time', 'calendar_link', 'doctor'],
  before_appointment: [...COMMON, 'date', 'time', 'calendar_link', 'doctor'],
  no_show: [...COMMON, 'date', 'time', 'doctor'],
  after_visit: [...COMMON, 'date'],
  recall_due: [...COMMON, 'date'],
  dues: [...COMMON, 'amount_due', 'upi_id'],
};

const VAR_RE = /\{([a-z_]+)\}/g;

export function variablesIn(body: string): string[] {
  return [...new Set([...body.matchAll(VAR_RE)].map((m) => m[1]!))];
}

export type Language = 'en' | 'hi';
export const LANGUAGE_LABEL: Record<Language, string> = { en: 'English', hi: 'Hindi' };

export interface TemplateInput {
  name: string;
  language: string;
  body: string;
}
export interface Template {
  name: string;
  language: Language;
  body: string;
}

export function checkTemplate(input: TemplateInput, opts: { doctorAllowed: boolean }): { ok: true; value: Template } | { ok: false; fieldErrors: FieldErrors } {
  const errors: FieldErrors = {};
  const name = (input.name ?? '').trim().replace(/\s+/g, ' ');
  const body = (input.body ?? '').replace(/\r\n/g, '\n').trim();
  if (name.length < 2 || name.length > 60) errors.name = 'Give it a short name (2 to 60 characters).';
  if (input.language !== 'en' && input.language !== 'hi') errors.language = 'Pick English or Hindi.';
  if (body.length < 5) errors.body = 'Write the message.';
  else if (body.length > 1000) errors.body = 'Keep it under 1,000 characters.';
  else {
    const unknown = variablesIn(body).filter((v) => !(VARIABLES as readonly string[]).includes(v));
    if (unknown.length) errors.body = `Unknown detail: {${unknown[0]}}. Use the buttons below the box.`;
    else if (!opts.doctorAllowed && body.includes('{doctor}')) errors.body = 'The doctor’s name is switched off for messages. Turn it on above, or remove {doctor}.';
  }
  if (Object.keys(errors).length) return { ok: false, fieldErrors: errors };
  return { ok: true, value: { name, language: input.language as Language, body } };
}

/** Details this template uses that a rule's trigger can't fill, e.g. {amount_due} on an appointment reminder. */
export function missingFor(trigger: Trigger, body: string): string[] {
  return variablesIn(body).filter((v) => !(TRIGGER_VARIABLES[trigger] as readonly string[]).includes(v));
}

/**
 * Fill in the details. A line whose details are all missing is left out
 * (no phone set → no "call us on" line), so a message never says "call us on .".
 */
export function renderMessage(body: string, vars: Partial<Record<Variable, string | null>>): string {
  const out: string[] = [];
  for (const line of body.split('\n')) {
    const used = [...line.matchAll(VAR_RE)].map((m) => m[1]!);
    const filled = line.replace(VAR_RE, (_, k: string) => (vars as Record<string, string | null | undefined>)[k] ?? '');
    if (used.length > 0 && used.every((k) => !(vars as Record<string, string | null | undefined>)[k])) continue;
    out.push(filled.replace(/[ \t]{2,}/g, ' ').trimEnd());
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export type Unit = 'minutes' | 'hours' | 'days';
export interface RuleInput {
  trigger: string;
  amount: string;
  unit: string;
  everyDays?: string;
  maxTimes?: string;
  templateId: string;
}
export interface Rule {
  trigger: Trigger;
  offsetMinutes: number;
  everyDays: number | null;
  maxTimes: number | null;
}

const UNIT_MIN: Record<Unit, number> = { minutes: 1, hours: 60, days: 24 * 60 };
const int = (s: string | undefined) => (/^\d{1,4}$/.test((s ?? '').trim()) ? Number((s ?? '').trim()) : null);

/** Timing for a rule. Limits keep it sane: before an appointment 5 minutes to 14 days, and so on. */
export function checkRule(input: RuleInput): { ok: true; value: Rule } | { ok: false; fieldErrors: FieldErrors } {
  const errors: FieldErrors = {};
  if (!isTrigger(input.trigger)) return { ok: false, fieldErrors: { trigger: 'Pick when it goes.' } };
  const trigger = input.trigger;
  const unit = (['minutes', 'hours', 'days'] as const).find((u) => u === input.unit);
  const amount = int(input.amount);
  let offsetMinutes = 0;
  let everyDays: number | null = null;
  let maxTimes: number | null = null;
  if (trigger === 'booked') {
    offsetMinutes = 0;
  } else if (trigger === 'dues') {
    everyDays = int(input.everyDays);
    maxTimes = int(input.maxTimes);
    if (everyDays === null || everyDays < 1 || everyDays > 60) errors.everyDays = 'Every 1 to 60 days.';
    if (maxTimes === null || maxTimes < 1 || maxTimes > 10) errors.maxTimes = 'At most 1 to 10 times.';
  } else {
    if (!unit) errors.unit = 'Pick minutes, hours or days.';
    if (amount === null) errors.amount = 'Enter a number.';
    if (unit && amount !== null) {
      offsetMinutes = amount * UNIT_MIN[unit];
      const [lo, hi, words] =
        trigger === 'before_appointment' ? [5, 14 * 1440, '5 minutes to 14 days'] :
        trigger === 'no_show' ? [0, 7 * 1440, 'up to 7 days'] :
        trigger === 'after_visit' ? [0, 60 * 1440, 'up to 60 days'] :
        [0, 30 * 1440, 'up to 30 days'];
      if (offsetMinutes < lo || offsetMinutes > hi) errors.amount = `Between ${words}.`;
      if ((trigger === 'after_visit' || trigger === 'recall_due') && unit !== 'days') errors.unit = 'Use days for this one.';
    }
  }
  if (Object.keys(errors).length) return { ok: false, fieldErrors: errors };
  return { ok: true, value: { trigger, offsetMinutes, everyDays, maxTimes } };
}

/** "1 day before", "2 hours before", "every 7 days, up to 3 times". */
export function timingWords(r: Rule): string {
  const span = (m: number) => {
    if (m === 0) return '';
    if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? '' : 's'}`;
    if (m % 60 === 0) return `${m / 60} hour${m === 60 ? '' : 's'}`;
    return `${m} minutes`;
  };
  switch (r.trigger) {
    case 'booked': return 'Right after booking';
    case 'before_appointment': return `${span(r.offsetMinutes)} before`;
    case 'no_show': return r.offsetMinutes ? `${span(r.offsetMinutes)} after a missed appointment` : 'Straight after a missed appointment';
    case 'after_visit': return r.offsetMinutes ? `${span(r.offsetMinutes)} after a visit` : 'The day of the visit';
    case 'recall_due': return r.offsetMinutes ? `${span(r.offsetMinutes)} before a come-back is due` : 'The day a come-back is due';
    case 'dues': return `Every ${r.everyDays} day${r.everyDays === 1 ? '' : 's'} while money is owed, up to ${r.maxTimes} time${r.maxTimes === 1 ? '' : 's'}`;
  }
}

export interface Quiet {
  start: string;
  end: string;
}
export const DEFAULT_QUIET: Quiet = { start: '21:00', end: '08:00' };

export function checkQuiet(start: string, end: string): { ok: true; value: Quiet } | { ok: false; fieldErrors: FieldErrors } {
  const errors: FieldErrors = {};
  const s = minutesOf(start);
  const e = minutesOf(end);
  if (s === null) errors.quietStart = 'Pick a time.';
  if (e === null) errors.quietEnd = 'Pick a time.';
  if (s !== null && e !== null && s === e) errors.quietEnd = 'Start and end can’t be the same.';
  if (Object.keys(errors).length) return { ok: false, fieldErrors: errors };
  return { ok: true, value: { start, end } };
}

function inQuiet(at: Date, q: Quiet): boolean {
  const m = minutesOf(istTime(at))!;
  const s = minutesOf(q.start)!;
  const e = minutesOf(q.end)!;
  return s < e ? m >= s && m < e : m >= s || m < e;
}

/** Move a time out of quiet hours: to the end of them (the next morning by default). */
export function afterQuiet(at: Date, q: Quiet): Date {
  if (!inQuiet(at, q)) return at;
  const day = businessDate(at);
  const sameDay = istInstant(day, q.end);
  return sameDay > at ? sameDay : istInstant(addDays(day, 1), q.end);
}

/** Move a time out of quiet hours backwards: just before they start. */
function beforeQuiet(at: Date, q: Quiet): Date {
  if (!inQuiet(at, q)) return at;
  const day = businessDate(at);
  const sameDay = new Date(istInstant(day, q.start).getTime() - 15 * 60_000);
  return sameDay <= at ? sameDay : new Date(istInstant(addDays(day, -1), q.start).getTime() - 15 * 60_000);
}

export interface PlannedRule extends Rule {
  id: string;
}

export interface Due {
  ruleId: string;
  /** Unique per message: the same key is never sent twice. */
  key: string;
  dueAt: Date;
  /** After this the message is pointless (the appointment has started, the come-back closed…). */
  expiresAt: Date;
  /** Groups messages that replace each other: only the latest due one in a group is shown. */
  group: string;
}

/**
 * An appointment's reminders. `plannedFrom` is when it was booked or last
 * moved: a "1 day before" rule is skipped for an appointment booked an hour
 * ahead rather than sent late. Keys include the start time, so a moved
 * appointment gets fresh reminders.
 */
export function planAppointment(
  a: { id: string; startsAt: Date; status: string; plannedFrom: Date; imported?: boolean },
  rules: readonly PlannedRule[],
  q: Quiet,
): Due[] {
  const at = a.startsAt.toISOString();
  const out: Due[] = [];
  if (a.status === 'booked' || a.status === 'confirmed') {
    for (const r of rules) {
      if (r.trigger === 'booked') {
        if (a.imported) continue;
        out.push({ ruleId: r.id, key: `${r.id}:${a.id}:${at}`, dueAt: afterQuiet(a.plannedFrom, q), expiresAt: a.startsAt, group: `appt:${a.id}` });
      } else if (r.trigger === 'before_appointment') {
        let due = new Date(a.startsAt.getTime() - r.offsetMinutes * 60_000);
        if (due < a.plannedFrom) continue;
        const later = afterQuiet(due, q);
        due = later < a.startsAt ? later : beforeQuiet(due, q);
        if (due < a.plannedFrom || due >= a.startsAt) continue;
        out.push({ ruleId: r.id, key: `${r.id}:${a.id}:${at}`, dueAt: due, expiresAt: a.startsAt, group: `appt:${a.id}` });
      }
    }
    out.sort((x, y) => x.dueAt.getTime() - y.dueAt.getTime());
    return out.slice(0, MAX_PER_APPOINTMENT);
  }
  if (a.status === 'no_show') {
    for (const r of rules) {
      if (r.trigger !== 'no_show') continue;
      const due = afterQuiet(new Date(a.startsAt.getTime() + r.offsetMinutes * 60_000), q);
      out.push({ ruleId: r.id, key: `${r.id}:${a.id}:${at}`, dueAt: due, expiresAt: new Date(due.getTime() + 3 * 86_400_000), group: `noshow:${a.id}` });
    }
  }
  return out;
}

/** A day-based message at DAY_SEND_TIME on `date`, kept for `keepDays`. */
function onDay(date: string, q: Quiet, keepDays: number): { dueAt: Date; expiresAt: Date } {
  const dueAt = afterQuiet(istInstant(date, DAY_SEND_TIME), q);
  return { dueAt, expiresAt: istInstant(addDays(date, keepDays + 1), '00:00') };
}

export function planVisit(v: { id: string; patientId: string; date: string }, rules: readonly PlannedRule[], q: Quiet): Due[] {
  return rules
    .filter((r) => r.trigger === 'after_visit')
    .map((r) => ({ ruleId: r.id, key: `${r.id}:${v.id}`, ...onDay(addDays(v.date, r.offsetMinutes / 1440), q, 2), group: `visit:${v.patientId}` }));
}

export function planRecall(c: { id: string; dueOn: string }, rules: readonly PlannedRule[], q: Quiet): Due[] {
  return rules
    .filter((r) => r.trigger === 'recall_due')
    .map((r) => ({ ruleId: r.id, key: `${r.id}:${c.id}:${c.dueOn}`, ...onDay(addDays(c.dueOn, -(r.offsetMinutes / 1440)), q, 7), group: `recall:${c.id}` }));
}

/**
 * Money owed: the first reminder `everyDays` after the oldest open bill, then
 * every `everyDays`, at most `maxTimes`. Paying everything stops them (the
 * service only asks for patients who still owe).
 */
export function planDues(d: { patientId: string; branchId: string; oldestOpen: string }, rules: readonly PlannedRule[], q: Quiet): Due[] {
  const out: Due[] = [];
  for (const r of rules) {
    if (r.trigger !== 'dues' || !r.everyDays || !r.maxTimes) continue;
    for (let k = 1; k <= r.maxTimes; k++) {
      out.push({ ruleId: r.id, key: `${r.id}:${d.patientId}:${d.branchId}:${d.oldestOpen}:${k}`, ...onDay(addDays(d.oldestOpen, k * r.everyDays), q, r.everyDays - 1), group: `dues:${d.patientId}:${d.branchId}` });
    }
  }
  return out;
}

/**
 * What the desk should see now: not sent or skipped, not expired, due before
 * the end of today; in each group only the latest one already due (an older
 * one missed is replaced, not sent late), plus anything still to come today.
 */
export function pickQueue(all: readonly Due[], done: ReadonlySet<string>, now: Date): { dueNow: Due[]; laterToday: Due[] } {
  const endOfToday = istInstant(addDays(businessDate(now), 1), '00:00');
  const live = all.filter((d) => !done.has(d.key) && d.expiresAt > now && d.dueAt < endOfToday);
  const latest = new Map<string, Due>();
  for (const d of live) {
    if (d.dueAt > now) continue;
    const cur = latest.get(d.group);
    if (!cur || d.dueAt > cur.dueAt) latest.set(d.group, d);
  }
  const dueNow = [...latest.values()].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const laterToday = live.filter((d) => d.dueAt > now).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  return { dueNow, laterToday };
}
