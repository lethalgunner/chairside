import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { branches, patients, paymentReminders } from '@/db/schema';
import { add, ZERO, type Paise } from '@/domain/money';
import { outstandingOf } from '@/domain/ledger';
import { duesReminderText, waLink, waNumber } from '@/domain/whatsapp';
import { canDo, ForbiddenError, UserFacingError, type TenantContext } from './context';
import { outstandingInvoices } from './receipts';
import { isUuid } from './util';

/**
 * WhatsApp dues reminders (Sprint 2, T32). Click-to-send only: Chairside
 * builds a wa.me link with a polite message and a person presses Send in
 * their own WhatsApp. Each open is logged in `payment_reminders` so the desk
 * can see when a patient was last reminded. The message text is never stored.
 *
 * The amount is always worked out here, from the branch's open bills, never
 * taken from the browser.
 */

export interface ReminderTarget {
  patientId: string;
  branchId: string;
  amountPaise: Paise;
  /** Null when the patient has no Indian mobile on file. */
  href: string | null;
  lastSentAt: Date | null;
}

export const reminderKey = (patientId: string, branchId: string) => `${patientId}:${branchId}`;

/**
 * Reminder links for (patient, branch, amount due) groups the page has
 * already worked out from open bills. Groups the user may not remind for, or
 * with nothing due, are left out.
 */
export async function reminderTargets(ctx: TenantContext, groups: { patientId: string; branchId: string; amountPaise: Paise }[]): Promise<Map<string, ReminderTarget>> {
  const allowed = groups.filter((g) => g.amountPaise > 0 && canDo(ctx, 'patient.remind', g.branchId));
  const out = new Map<string, ReminderTarget>();
  if (allowed.length === 0) return out;
  const patientIds = [...new Set(allowed.map((g) => g.patientId))];
  const branchIds = [...new Set(allowed.map((g) => g.branchId))];
  const db = getDb();
  const [ps, bs, sent] = await Promise.all([
    db.select({ id: patients.id, fullName: patients.fullName, phone: patients.phone }).from(patients).where(and(eq(patients.orgId, ctx.orgId), inArray(patients.id, patientIds))),
    db
      .select({ id: branches.id, name: branches.name, phone: branches.phone, upiId: branches.upiId, upiPayee: branches.upiPayee })
      .from(branches)
      .where(and(eq(branches.orgId, ctx.orgId), inArray(branches.id, branchIds))),
    db
      .select({ patientId: paymentReminders.patientId, branchId: paymentReminders.branchId, sentAt: paymentReminders.sentAt })
      .from(paymentReminders)
      .where(and(eq(paymentReminders.orgId, ctx.orgId), inArray(paymentReminders.patientId, patientIds), inArray(paymentReminders.branchId, branchIds)))
      .orderBy(desc(paymentReminders.sentAt)),
  ]);
  const patient = new Map(ps.map((p) => [p.id, p]));
  const branch = new Map(bs.map((b) => [b.id, b]));
  const last = new Map<string, Date>();
  for (const s of sent) {
    const k = reminderKey(s.patientId, s.branchId);
    if (!last.has(k)) last.set(k, s.sentAt);
  }
  for (const g of allowed) {
    const p = patient.get(g.patientId);
    const b = branch.get(g.branchId);
    if (!p || !b) continue;
    const text = duesReminderText({ patientName: p.fullName, branchName: b.name, amount: g.amountPaise, upiId: b.upiPayee ? b.upiId : null, branchPhone: b.phone });
    const k = reminderKey(g.patientId, g.branchId);
    out.set(k, { patientId: g.patientId, branchId: g.branchId, amountPaise: g.amountPaise, href: waNumber(p.phone) ? waLink(text, p.phone) : null, lastSentAt: last.get(k) ?? null });
  }
  return out;
}

/**
 * Log that a reminder was opened. Re-checks the permission and recomputes
 * the amount due at that branch; refuses when nothing is due.
 */
export async function logReminder(ctx: TenantContext, patientId: string, branchId: string): Promise<{ sentAt: Date; amountPaise: Paise }> {
  if (!isUuid(patientId) || !isUuid(branchId)) throw new ForbiddenError();
  if (!canDo(ctx, 'patient.remind', branchId)) throw new ForbiddenError();
  const db = getDb();
  const [p] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.orgId, ctx.orgId))).limit(1);
  if (!p) throw new ForbiddenError();
  const open = await outstandingInvoices(db, ctx.orgId, branchId, patientId);
  const amountPaise = add(ZERO, ...open.map(outstandingOf));
  if (amountPaise <= 0) throw new UserFacingError('Nothing is due at this branch any more. Refresh the page.');
  const [row] = await db.insert(paymentReminders).values({ orgId: ctx.orgId, branchId, patientId, amountPaise, sentBy: ctx.userId }).returning({ sentAt: paymentReminders.sentAt });
  return { sentAt: row!.sentAt, amountPaise };
}
