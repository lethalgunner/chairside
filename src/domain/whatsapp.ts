/**
 * WhatsApp click-to-send (Sprint 2, T32 and T33). Pure and unit-tested.
 *
 * Chairside never sends a WhatsApp message itself. It opens WhatsApp with a
 * pre-written message (https://wa.me/<number>?text=…, per WhatsApp's
 * click-to-chat FAQ) and a person presses Send. No API, no cost, nothing
 * stored at Meta by us.
 *
 * Message text carries NO clinical detail (CLAUDE.md): no treatments, teeth,
 * doctor names or notes. A patient message has the first name, branch,
 * amount and how to pay; the owner's day summary has totals only.
 */
import { businessDate } from './dates';
import { formatINR, type Paise } from './money';

/** A 10-digit Indian mobile → the international digits wa.me wants (no +, no 0). */
export function waNumber(mobile10: string): string | null {
  return /^[6-9]\d{9}$/.test(mobile10) ? `91${mobile10}` : null;
}

/** wa.me link. Without a number, WhatsApp asks the sender to pick a chat. */
export function waLink(text: string, mobile10?: string | null): string {
  const n = mobile10 ? waNumber(mobile10) : null;
  return `https://wa.me/${n ?? ''}?text=${encodeURIComponent(text)}`;
}

/** "Asha Testpatient" → "Asha"; a name that is all initials or titles falls back to the whole name. */
export function firstName(fullName: string): string {
  const words = fullName.trim().split(/\s+/);
  const titles = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'master', 'baby', 'smt', 'shri', 'kumari']);
  const first = words.find((w) => w.replace(/\./g, '').length > 1 && !titles.has(w.replace(/\./g, '').toLowerCase()));
  return first ?? fullName.trim();
}

export interface ReminderInput {
  patientName: string;
  branchName: string;
  amount: Paise;
  upiId: string | null;
  branchPhone: string | null;
}

/** The polite dues reminder a front desk sends from its own WhatsApp. */
export function duesReminderText(r: ReminderInput): string {
  const lines = [
    `Namaste ${firstName(r.patientName)},`,
    `This is a gentle reminder from ${r.branchName}. ${formatINR(r.amount)} is pending on your account.`,
  ];
  if (r.upiId) lines.push(`You can pay by UPI to ${r.upiId}, or at the clinic on your next visit.`);
  else lines.push('You can pay at the clinic on your next visit.');
  lines.push(r.branchPhone ? `Questions? Call us on ${r.branchPhone}. Thank you!` : 'Thank you!');
  return lines.join('\n');
}

export interface DaySummaryInput {
  branchName: string;
  /** e.g. "Wed 28 Oct" */
  dayLabel: string;
  billCount: number;
  billedPaise: Paise;
  collected: { mode: string; amountPaise: Paise }[];
  collectedPaise: Paise;
  cashOutPaise: Paise;
  /** Counted − expected; null when no count. */
  variancePaise: Paise | null;
  closedBy: string;
  /** The old-vs-Chairside verdict as shown at day close, or null when not entered. */
  legacyVerdict: string | null;
  unbilledCount: number;
}

const signed = (p: Paise) => (p === 0 ? 'exact' : p > 0 ? `over by ${formatINR(p)}` : `short by ${formatINR(Math.abs(p) as Paise)}`);

/** The owner's end-of-day message. Totals only, no patient anywhere. */
export function daySummaryText(s: DaySummaryInput): string {
  const lines = [
    `*${s.branchName} · ${s.dayLabel}* (Chairside day close)`,
    `Bills: ${s.billCount} · ${formatINR(s.billedPaise)}`,
    `Collected: ${formatINR(s.collectedPaise)}`,
  ];
  for (const c of s.collected) lines.push(`  ${c.mode}: ${formatINR(c.amountPaise)}`);
  if (s.cashOutPaise > 0) lines.push(`Cash paid out: ${formatINR(s.cashOutPaise)}`);
  lines.push(`Drawer: ${s.variancePaise === null ? 'not counted' : signed(s.variancePaise)}`);
  if (s.unbilledCount > 0) lines.push(`Done, not billed: ${s.unbilledCount}`);
  if (s.legacyVerdict) lines.push(`Old software: ${s.legacyVerdict}`);
  lines.push(`Closed by ${firstName(s.closedBy)}`);
  return lines.join('\n');
}

/** "Reminded today" / "yesterday" / "3 days ago", counted in IST business days. */
export function remindedLabel(sentAt: Date, now: Date = new Date()): string {
  const days = Math.round((Date.parse(`${businessDate(now)}T00:00:00Z`) - Date.parse(`${businessDate(sentAt)}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return 'Reminded today';
  if (days === 1) return 'Reminded yesterday';
  return `Reminded ${days} days ago`;
}
