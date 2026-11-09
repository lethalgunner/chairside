import { and, asc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { getDb, type DB, type Tx } from '@/db/client';
import { appointments, branches, messageRules, messageSends, messageTemplates, organisations, patients, providers, recalls, visits } from '@/db/schema';
import { istInstant } from '@/domain/appointments';
import { addDays, businessDate, istTime, shortDay } from '@/domain/dates';
import { googleCalendarLink } from '@/domain/ics';
import {
  APPOINTMENT_TRIGGERS,
  checkQuiet,
  checkRule,
  checkTemplate,
  MAX_PER_APPOINTMENT,
  missingFor,
  pickQueue,
  planAppointment,
  planDues,
  planRecall,
  planVisit,
  renderMessage,
  timingWords,
  TRIGGER_LABEL,
  type Due,
  type Language,
  type PlannedRule,
  type Quiet,
  type RuleInput,
  type TemplateInput,
  type Trigger,
  type Variable,
} from '@/domain/messages';
import { formatINR, type Paise } from '@/domain/money';
import { canOrgWide } from '@/domain/permissions';
import type { FieldErrors } from '@/domain/staff';
import { firstName, waLink, waNumber } from '@/domain/whatsapp';
import { writeAudit } from './audit';
import { getPrintHeader } from './branches';
import { canAnywhere, canDo, ForbiddenError, UserFacingError, type TenantContext } from './context';
import { listInvoices } from './invoices';
import { isUuid } from './util';

/**
 * Settings → Reminders and Today's messages (Sprint 8, ADR-020, Mode 1).
 * Rules and wording are the clinic's; the planner in domain/messages works
 * out what is due from appointments, visits, come-backs and dues on every
 * read, and message_sends records what the desk sent or skipped. A clinic
 * with no rules gets an empty queue and no extra queries: nothing changes
 * until the owner sets reminders up.
 */

function assertOwner(ctx: TenantContext) {
  if (!canOrgWide(ctx.grants, 'staff.manage')) throw new ForbiddenError();
}

type Fail = { ok: false; fieldErrors: FieldErrors };
type Result<T = undefined> = ({ ok: true } & (T extends undefined ? object : T)) | Fail;
const fail = (fieldErrors: FieldErrors): Fail => ({ ok: false, fieldErrors });

export interface TemplateRow {
  id: string;
  name: string;
  language: Language;
  body: string;
  inUse: number;
}
export interface RuleRow {
  id: string;
  trigger: Trigger;
  label: string;
  timing: string;
  templateId: string;
  templateName: string;
  branchId: string | null;
  branchName: string;
  active: boolean;
}
export interface MessageSettings {
  quiet: Quiet;
  doctorName: boolean;
  templates: TemplateRow[];
  rules: RuleRow[];
}

async function orgOptions(db: DB | Tx, orgId: string) {
  const [o] = await db
    .select({ name: organisations.name, quietStart: organisations.messagesQuietStart, quietEnd: organisations.messagesQuietEnd, doctorName: organisations.messagesDoctorName })
    .from(organisations)
    .where(eq(organisations.id, orgId));
  if (!o) throw new ForbiddenError();
  return { name: o.name, quiet: { start: o.quietStart, end: o.quietEnd }, doctorName: o.doctorName };
}

export async function getMessageSettings(ctx: TenantContext): Promise<MessageSettings> {
  assertOwner(ctx);
  const db = getDb();
  const opts = await orgOptions(db, ctx.orgId);
  const tpl = await db.select().from(messageTemplates).where(and(eq(messageTemplates.orgId, ctx.orgId), isNull(messageTemplates.removedAt))).orderBy(asc(messageTemplates.name));
  const rules = await db
    .select({ r: messageRules, branchName: branches.name })
    .from(messageRules)
    .leftJoin(branches, eq(branches.id, messageRules.branchId))
    .where(and(eq(messageRules.orgId, ctx.orgId), isNull(messageRules.removedAt)))
    .orderBy(asc(messageRules.createdAt));
  const order = (t: string) => ['booked', 'before_appointment', 'no_show', 'after_visit', 'recall_due', 'dues'].indexOf(t);
  return {
    quiet: opts.quiet,
    doctorName: opts.doctorName,
    templates: tpl.map((t) => ({ id: t.id, name: t.name, language: t.language as Language, body: t.body, inUse: rules.filter((x) => x.r.templateId === t.id).length })),
    rules: rules
      .map(({ r, branchName }) => {
        const rule = { trigger: r.trigger as Trigger, offsetMinutes: r.offsetMinutes, everyDays: r.everyDays, maxTimes: r.maxTimes };
        return {
          id: r.id,
          trigger: rule.trigger,
          label: TRIGGER_LABEL[rule.trigger],
          timing: timingWords(rule),
          templateId: r.templateId,
          templateName: tpl.find((t) => t.id === r.templateId)?.name ?? '—',
          branchId: r.branchId,
          branchName: branchName ?? 'Every branch',
          active: r.active,
          offset: r.offsetMinutes,
        };
      })
      .sort((a, b) => order(a.trigger) - order(b.trigger) || b.offset - a.offset)
      .map(({ offset: _o, ...r }) => r),
  };
}

export async function saveMessageOptions(ctx: TenantContext, input: { quietStart: string; quietEnd: string; doctorName: boolean }): Promise<Result> {
  assertOwner(ctx);
  const q = checkQuiet(input.quietStart, input.quietEnd);
  if (!q.ok) return q;
  return getDb().transaction(async (tx) => {
    const before = await orgOptions(tx, ctx.orgId);
    if (!input.doctorName) {
      const uses = await tx.select({ name: messageTemplates.name, body: messageTemplates.body }).from(messageTemplates).where(and(eq(messageTemplates.orgId, ctx.orgId), isNull(messageTemplates.removedAt)));
      const using = uses.find((t) => t.body.includes('{doctor}'));
      if (using) return fail({ doctorName: `“${using.name}” uses {doctor}. Remove it there first.` });
    }
    await tx.update(organisations).set({ messagesQuietStart: q.value.start, messagesQuietEnd: q.value.end, messagesDoctorName: input.doctorName }).where(eq(organisations.id, ctx.orgId));
    await writeAudit(tx, ctx, { action: 'messages.options', entityType: 'organisation', entityId: ctx.orgId, before: { quiet: before.quiet, doctorName: before.doctorName }, after: { quiet: q.value, doctorName: input.doctorName } });
    return { ok: true as const };
  });
}

export async function saveTemplate(ctx: TenantContext, id: string | null, input: TemplateInput): Promise<Result<{ id: string }>> {
  assertOwner(ctx);
  const db = getDb();
  const { doctorName } = await orgOptions(db, ctx.orgId);
  const checked = checkTemplate(input, { doctorAllowed: doctorName });
  if (!checked.ok) return checked;
  return db.transaction(async (tx) => {
    if (id) {
      if (!isUuid(id)) throw new ForbiddenError();
      const [t] = await tx.select().from(messageTemplates).where(and(eq(messageTemplates.id, id), eq(messageTemplates.orgId, ctx.orgId), isNull(messageTemplates.removedAt))).for('update');
      if (!t) throw new ForbiddenError();
      // A template already used by a rule must still fit that rule.
      const used = await tx.select({ trigger: messageRules.trigger }).from(messageRules).where(and(eq(messageRules.templateId, t.id), isNull(messageRules.removedAt)));
      for (const u of used) {
        const missing = missingFor(u.trigger as Trigger, checked.value.body);
        if (missing.length) return fail({ body: `{${missing[0]}} can’t be filled for “${TRIGGER_LABEL[u.trigger as Trigger]}”, which uses this wording.` });
      }
      await tx.update(messageTemplates).set({ ...checked.value, updatedAt: new Date() }).where(eq(messageTemplates.id, t.id));
      await writeAudit(tx, ctx, { action: 'messages.template_update', entityType: 'message_template', entityId: t.id, before: { name: t.name, language: t.language, body: t.body }, after: checked.value });
      return { ok: true as const, id: t.id };
    }
    const [row] = await tx.insert(messageTemplates).values({ orgId: ctx.orgId, ...checked.value }).returning({ id: messageTemplates.id });
    await writeAudit(tx, ctx, { action: 'messages.template_add', entityType: 'message_template', entityId: row!.id, after: checked.value });
    return { ok: true as const, id: row!.id };
  });
}

export async function removeTemplate(ctx: TenantContext, id: string): Promise<void> {
  assertOwner(ctx);
  if (!isUuid(id)) throw new ForbiddenError();
  await getDb().transaction(async (tx) => {
    const [t] = await tx.select().from(messageTemplates).where(and(eq(messageTemplates.id, id), eq(messageTemplates.orgId, ctx.orgId))).for('update');
    if (!t) throw new ForbiddenError();
    if (t.removedAt) return;
    const [used] = await tx.select({ id: messageRules.id }).from(messageRules).where(and(eq(messageRules.templateId, t.id), isNull(messageRules.removedAt))).limit(1);
    if (used) throw new UserFacingError('A reminder still uses this wording. Remove that reminder first.');
    await tx.update(messageTemplates).set({ removedAt: new Date() }).where(eq(messageTemplates.id, t.id));
    await writeAudit(tx, ctx, { action: 'messages.template_remove', entityType: 'message_template', entityId: t.id });
  });
}

export async function addRule(ctx: TenantContext, input: RuleInput & { branchId: string }): Promise<Result<{ id: string }>> {
  assertOwner(ctx);
  const checked = checkRule(input);
  if (!checked.ok) return checked;
  const branchId = input.branchId || null;
  const db = getDb();
  return db.transaction(async (tx) => {
    if (branchId) {
      if (!isUuid(branchId)) throw new ForbiddenError();
      const [b] = await tx.select({ id: branches.id }).from(branches).where(and(eq(branches.id, branchId), eq(branches.orgId, ctx.orgId)));
      if (!b) throw new ForbiddenError();
    }
    if (!isUuid(input.templateId)) return fail({ templateId: 'Pick the wording.' });
    const [t] = await tx.select().from(messageTemplates).where(and(eq(messageTemplates.id, input.templateId), eq(messageTemplates.orgId, ctx.orgId), isNull(messageTemplates.removedAt)));
    if (!t) return fail({ templateId: 'Pick the wording.' });
    const missing = missingFor(checked.value.trigger, t.body);
    if (missing.length) return fail({ templateId: `“${t.name}” uses {${missing[0]}}, which this kind of reminder can’t fill. Pick other wording.` });
    if ((APPOINTMENT_TRIGGERS as readonly string[]).includes(checked.value.trigger) && checked.value.trigger !== 'no_show') {
      // At most 6 per appointment: count every live booking/before rule that could apply at the same branch.
      const live = await tx
        .select({ branchId: messageRules.branchId })
        .from(messageRules)
        .where(and(eq(messageRules.orgId, ctx.orgId), isNull(messageRules.removedAt), eq(messageRules.active, true), inArray(messageRules.trigger, ['booked', 'before_appointment'])));
      const overlapping = live.filter((r) => r.branchId === null || branchId === null || r.branchId === branchId).length;
      if (overlapping >= MAX_PER_APPOINTMENT) return fail({ trigger: `At most ${MAX_PER_APPOINTMENT} reminders per appointment. Remove one first.` });
    }
    const [row] = await tx
      .insert(messageRules)
      .values({ orgId: ctx.orgId, branchId, templateId: t.id, ...checked.value })
      .returning({ id: messageRules.id });
    await writeAudit(tx, ctx, { action: 'messages.rule_add', entityType: 'message_rule', entityId: row!.id, branchId, after: { ...checked.value, templateId: t.id } });
    return { ok: true as const, id: row!.id };
  });
}

export async function setRuleActive(ctx: TenantContext, id: string, active: boolean): Promise<void> {
  assertOwner(ctx);
  if (!isUuid(id)) throw new ForbiddenError();
  await getDb().transaction(async (tx) => {
    const [r] = await tx.select().from(messageRules).where(and(eq(messageRules.id, id), eq(messageRules.orgId, ctx.orgId), isNull(messageRules.removedAt))).for('update');
    if (!r) throw new ForbiddenError();
    if (r.active === active) return;
    await tx.update(messageRules).set({ active }).where(eq(messageRules.id, r.id));
    await writeAudit(tx, ctx, { action: active ? 'messages.rule_on' : 'messages.rule_off', entityType: 'message_rule', entityId: r.id, branchId: r.branchId });
  });
}

export async function removeRule(ctx: TenantContext, id: string): Promise<void> {
  assertOwner(ctx);
  if (!isUuid(id)) throw new ForbiddenError();
  await getDb().transaction(async (tx) => {
    const [r] = await tx.select().from(messageRules).where(and(eq(messageRules.id, id), eq(messageRules.orgId, ctx.orgId))).for('update');
    if (!r) throw new ForbiddenError();
    if (r.removedAt) return;
    await tx.update(messageRules).set({ removedAt: new Date(), active: false }).where(eq(messageRules.id, r.id));
    await writeAudit(tx, ctx, { action: 'messages.rule_remove', entityType: 'message_rule', entityId: r.id, branchId: r.branchId });
  });
}

/** Suggested wording. Hindi is a first draft: have a native speaker read it before relying on it. */
export const SUGGESTED_TEMPLATES: { key: string; name: string; language: Language; body: string }[] = [
  { key: 'confirm', name: 'Booking confirmation', language: 'en', body: 'Namaste {first_name},\nYour appointment at {branch} is on {date} at {time}.\nAddress: {address}\nAdd it to your calendar: {calendar_link}\nTo change the time, call us on {phone}. Thank you!' },
  { key: 'remind', name: 'Appointment reminder', language: 'en', body: 'Namaste {first_name}, a reminder of your appointment at {branch} on {date} at {time}.\nTo change it, call us on {phone}.' },
  { key: 'remind_hi', name: 'Appointment reminder (Hindi)', language: 'hi', body: 'नमस्ते {first_name}, {branch} में आपका अपॉइंटमेंट {date} को {time} बजे है।\nसमय बदलने के लिए {phone} पर कॉल करें।' },
  { key: 'missed', name: 'Missed appointment', language: 'en', body: 'Namaste {first_name}, we missed you at {branch} today.\nCall us on {phone} to book another time.' },
  { key: 'comeback', name: 'Come-back due', language: 'en', body: 'Namaste {first_name}, it’s time for your next visit at {branch}.\nCall us on {phone} to book a time. Thank you!' },
  { key: 'dues', name: 'Money owed', language: 'en', body: 'Namaste {first_name}, a gentle reminder from {branch}: {amount_due} is pending on your account.\nYou can pay by UPI to {upi_id}, or at the clinic on your next visit.\nQuestions? Call us on {phone}. Thank you!' },
];
const SUGGESTED_RULES: { trigger: Trigger; offsetMinutes: number; everyDays?: number; maxTimes?: number; template: string }[] = [
  { trigger: 'booked', offsetMinutes: 0, template: 'confirm' },
  { trigger: 'before_appointment', offsetMinutes: 1440, template: 'remind' },
  { trigger: 'before_appointment', offsetMinutes: 120, template: 'remind' },
  { trigger: 'no_show', offsetMinutes: 120, template: 'missed' },
  { trigger: 'recall_due', offsetMinutes: 0, template: 'comeback' },
  { trigger: 'dues', offsetMinutes: 0, everyDays: 7, maxTimes: 3, template: 'dues' },
];

/** One tap to a sensible starting set, only when the clinic has none yet. */
export async function addSuggestedReminders(ctx: TenantContext): Promise<void> {
  assertOwner(ctx);
  await getDb().transaction(async (tx) => {
    await tx.select({ id: organisations.id }).from(organisations).where(eq(organisations.id, ctx.orgId)).for('update');
    const [any] = await tx.select({ id: messageRules.id }).from(messageRules).where(and(eq(messageRules.orgId, ctx.orgId), isNull(messageRules.removedAt))).limit(1);
    if (any) throw new UserFacingError('You already have reminders. Add more one at a time below.');
    const ids = new Map<string, string>();
    for (const t of SUGGESTED_TEMPLATES) {
      const [row] = await tx.insert(messageTemplates).values({ orgId: ctx.orgId, name: t.name, language: t.language, body: t.body }).returning({ id: messageTemplates.id });
      ids.set(t.key, row!.id);
    }
    for (const r of SUGGESTED_RULES) {
      await tx.insert(messageRules).values({ orgId: ctx.orgId, branchId: null, trigger: r.trigger, offsetMinutes: r.offsetMinutes, everyDays: r.everyDays ?? null, maxTimes: r.maxTimes ?? null, templateId: ids.get(r.template)! });
    }
    await writeAudit(tx, ctx, { action: 'messages.suggested', entityType: 'organisation', entityId: ctx.orgId, after: { templates: SUGGESTED_TEMPLATES.length, rules: SUGGESTED_RULES.length } });
  });
}

// ─── Today's messages ────────────────────────────────────────────────────────

export interface QueueItem {
  key: string;
  ruleId: string;
  ruleLabel: string;
  timing: string;
  patientId: string;
  patientName: string;
  /** "Thu 12 Nov 11:00", "₹4,500.00 owed", "Check-up due Tue 1 Dec". */
  about: string;
  dueAt: Date;
  text: string;
  /** wa.me link, or null when the patient has no WhatsApp-able mobile. */
  href: string | null;
}

export interface Queue {
  configured: boolean;
  dueNow: QueueItem[];
  laterToday: QueueItem[];
}

interface Planned extends Due {
  patientId: string;
  patientName: string;
  phone: string;
  about: string;
  vars: Partial<Record<Variable, string | null>>;
}

/** Everything due today at a branch, worked out from the clinic's rules. */
export async function todaysMessages(ctx: TenantContext, branchId: string, now: Date = new Date()): Promise<Queue> {
  if (!canDo(ctx, 'patient.remind', branchId)) throw new ForbiddenError();
  const db = getDb();
  const ruleRows = await db
    .select({ r: messageRules, body: messageTemplates.body })
    .from(messageRules)
    .innerJoin(messageTemplates, eq(messageTemplates.id, messageRules.templateId))
    .where(and(eq(messageRules.orgId, ctx.orgId), eq(messageRules.active, true), isNull(messageRules.removedAt), or(isNull(messageRules.branchId), eq(messageRules.branchId, branchId))));
  if (ruleRows.length === 0) return { configured: false, dueNow: [], laterToday: [] };
  const rules: (PlannedRule & { body: string })[] = ruleRows.map(({ r, body }) => ({ id: r.id, trigger: r.trigger as Trigger, offsetMinutes: r.offsetMinutes, everyDays: r.everyDays, maxTimes: r.maxTimes, body }));
  const has = (t: Trigger) => rules.some((r) => r.trigger === t);
  const opts = await orgOptions(db, ctx.orgId);
  const head = await getPrintHeader(ctx, branchId, db);
  const [b] = await db.select({ upiId: branches.upiId, name: branches.name }).from(branches).where(eq(branches.id, branchId));
  const today = businessDate(now);
  const address = head.addressLines.join(', ') || null;
  const base = { clinic: opts.name, branch: head.name, address, phone: head.phone };
  const planned: Planned[] = [];

  if (rules.some((r) => (APPOINTMENT_TRIGGERS as readonly string[]).includes(r.trigger))) {
    const rows = await db
      .select({ a: appointments, name: patients.fullName, phone: patients.phone, stopped: patients.messagesStoppedAt, doctor: providers.fullName })
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .innerJoin(providers, eq(providers.id, appointments.doctorId))
      .where(
        and(
          eq(appointments.orgId, ctx.orgId),
          eq(appointments.branchId, branchId),
          inArray(appointments.status, ['booked', 'confirmed', 'no_show']),
          gte(appointments.startsAt, istInstant(addDays(today, -8), '00:00')),
          lte(appointments.startsAt, istInstant(addDays(today, 16), '00:00')),
        ),
      );
    for (const { a, name, phone, stopped, doctor } of rows) {
      if (stopped) continue;
      const vars = {
        ...base,
        first_name: firstName(name),
        date: shortDay(businessDate(a.startsAt)),
        time: istTime(a.startsAt),
        calendar_link: googleCalendarLink({ title: `Dental appointment, ${head.name}`, start: a.startsAt, end: a.endsAt, location: address ?? head.name }),
        doctor: opts.doctorName ? doctor : null,
      };
      const plannedFrom = a.updatedAt > a.createdAt ? a.updatedAt : a.createdAt;
      for (const d of planAppointment({ id: a.id, startsAt: a.startsAt, status: a.status, plannedFrom }, rules, opts.quiet)) {
        planned.push({ ...d, patientId: a.patientId, patientName: name, phone, about: `${vars.date} ${vars.time}`, vars });
      }
    }
  }

  if (has('after_visit')) {
    const rows = await db
      .select({ id: visits.id, patientId: visits.patientId, date: visits.businessDate, name: patients.fullName, phone: patients.phone, stopped: patients.messagesStoppedAt })
      .from(visits)
      .innerJoin(patients, eq(patients.id, visits.patientId))
      .where(and(eq(visits.orgId, ctx.orgId), eq(visits.branchId, branchId), eq(visits.status, 'done'), gte(visits.businessDate, addDays(today, -62)), lte(visits.businessDate, today)));
    for (const v of rows) {
      if (v.stopped) continue;
      for (const d of planVisit({ id: v.id, patientId: v.patientId, date: v.date }, rules, opts.quiet)) {
        planned.push({ ...d, patientId: v.patientId, patientName: v.name, phone: v.phone, about: `Visit ${shortDay(v.date)}`, vars: { ...base, first_name: firstName(v.name), date: shortDay(v.date) } });
      }
    }
  }

  if (has('recall_due')) {
    const rows = await db
      .select({ id: recalls.id, patientId: recalls.patientId, dueOn: recalls.dueOn, name: patients.fullName, phone: patients.phone, stopped: patients.messagesStoppedAt })
      .from(recalls)
      .innerJoin(patients, eq(patients.id, recalls.patientId))
      .where(and(eq(recalls.orgId, ctx.orgId), eq(recalls.branchId, branchId), eq(recalls.status, 'open'), gte(recalls.dueOn, addDays(today, -8)), lte(recalls.dueOn, addDays(today, 31))));
    for (const c of rows) {
      if (c.stopped) continue;
      for (const d of planRecall({ id: c.id, dueOn: c.dueOn }, rules, opts.quiet)) {
        planned.push({ ...d, patientId: c.patientId, patientName: c.name, phone: c.phone, about: `Come-back due ${shortDay(c.dueOn)}`, vars: { ...base, first_name: firstName(c.name), date: shortDay(c.dueOn) } });
      }
    }
  }

  if (has('dues')) {
    const open = await listInvoices(ctx, { branchIds: [branchId], openOnly: true });
    const byPatient = new Map<string, { name: string; due: Paise; oldest: string }>();
    for (const i of open) {
      if (i.duePaise <= 0) continue;
      const cur = byPatient.get(i.patientId);
      if (!cur) byPatient.set(i.patientId, { name: i.patientName, due: i.duePaise, oldest: i.issuedOn });
      else {
        cur.due = (cur.due + i.duePaise) as Paise;
        if (i.issuedOn < cur.oldest) cur.oldest = i.issuedOn;
      }
    }
    if (byPatient.size) {
      const info = await db.select({ id: patients.id, phone: patients.phone, stopped: patients.messagesStoppedAt }).from(patients).where(and(eq(patients.orgId, ctx.orgId), inArray(patients.id, [...byPatient.keys()])));
      for (const p of info) {
        if (p.stopped) continue;
        const d0 = byPatient.get(p.id)!;
        for (const d of planDues({ patientId: p.id, branchId, oldestOpen: d0.oldest }, rules, opts.quiet)) {
          planned.push({ ...d, patientId: p.id, patientName: d0.name, phone: p.phone, about: `${formatINR(d0.due)} owed`, vars: { ...base, first_name: firstName(d0.name), amount_due: formatINR(d0.due), upi_id: b?.upiId ?? null } });
        }
      }
    }
  }

  const keys = planned.map((p) => p.key);
  const done = new Set<string>();
  for (let i = 0; i < keys.length; i += 500) {
    const chunk = keys.slice(i, i + 500);
    const rows = await db.select({ key: messageSends.key }).from(messageSends).where(and(eq(messageSends.orgId, ctx.orgId), inArray(messageSends.key, chunk)));
    for (const r of rows) done.add(r.key);
  }
  const { dueNow, laterToday } = pickQueue(planned, done, now);
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const toItem = (d: Due): QueueItem => {
    const p = d as Planned;
    const r = ruleById.get(d.ruleId)!;
    const text = renderMessage(r.body, p.vars);
    return { key: d.key, ruleId: d.ruleId, ruleLabel: TRIGGER_LABEL[r.trigger], timing: timingWords(r), patientId: p.patientId, patientName: p.patientName, about: p.about, dueAt: d.dueAt, text, href: waNumber(p.phone) ? waLink(text, p.phone) : null };
  };
  return { configured: true, dueNow: dueNow.map(toItem), laterToday: laterToday.map(toItem) };
}

/** The desk tapped Send (or Skip). Only a message that is in today's list can be marked, and only once. */
export async function markMessage(ctx: TenantContext, branchId: string, key: string, outcome: 'sent' | 'skipped', now: Date = new Date()): Promise<void> {
  if (!canDo(ctx, 'patient.remind', branchId)) throw new ForbiddenError();
  const q = await todaysMessages(ctx, branchId, now);
  const item = [...q.dueNow, ...q.laterToday].find((i) => i.key === key);
  if (!item) return; // already marked, or no longer due: nothing to do
  const ruleId = item.ruleId;
  await getDb().transaction(async (tx) => {
    const ins = await tx
      .insert(messageSends)
      .values({ orgId: ctx.orgId, branchId, patientId: item.patientId, ruleId, key, outcome, by: ctx.userId })
      .onConflictDoNothing()
      .returning({ id: messageSends.id });
    if (ins.length) await writeAudit(tx, ctx, { action: outcome === 'sent' ? 'message.sent' : 'message.skipped', entityType: 'patient', entityId: item.patientId, branchId, after: { ruleId } });
  });
}

/** The patient replied STOP (or asked in person). No planned reminder goes to them under any rule. */
export async function setMessagesStopped(ctx: TenantContext, patientId: string, stopped: boolean): Promise<void> {
  if (!canAnywhere(ctx, 'patient.remind')) throw new ForbiddenError();
  if (!isUuid(patientId)) throw new ForbiddenError();
  await getDb().transaction(async (tx) => {
    const [p] = await tx.select({ id: patients.id, stoppedAt: patients.messagesStoppedAt }).from(patients).where(and(eq(patients.id, patientId), eq(patients.orgId, ctx.orgId))).for('update');
    if (!p) throw new ForbiddenError();
    if (!!p.stoppedAt === stopped) return;
    await tx.update(patients).set({ messagesStoppedAt: stopped ? new Date() : null }).where(eq(patients.id, p.id));
    await writeAudit(tx, ctx, { action: stopped ? 'patient.messages_stop' : 'patient.messages_resume', entityType: 'patient', entityId: p.id });
  });
}

export async function messagesStopped(ctx: TenantContext, patientId: string): Promise<boolean> {
  if (!isUuid(patientId)) return false;
  const [p] = await getDb().select({ s: patients.messagesStoppedAt }).from(patients).where(and(eq(patients.id, patientId), eq(patients.orgId, ctx.orgId)));
  return !!p?.s;
}
