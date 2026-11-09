/**
 * Waiting room and recalls (Sprint 3, T36 and T37). Pure and unit-tested.
 */
import { addDays } from './dates';

export type VisitStatus = 'waiting' | 'in_chair' | 'done' | 'left';

export const VISIT_LABEL: Record<VisitStatus, string> = {
  waiting: 'Waiting',
  in_chair: 'In chair',
  done: 'Done',
  left: 'Left',
};

/** Forward only, plus one undo (In chair → Waiting, for a patient seated by mistake). Done and Left are final. */
const ALLOWED: Record<VisitStatus, readonly VisitStatus[]> = {
  waiting: ['in_chair', 'done', 'left'],
  in_chair: ['done', 'waiting'],
  done: [],
  left: [],
};

export function canMoveVisit(from: VisitStatus, to: VisitStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function isVisitStatus(v: string): v is VisitStatus {
  return v in ALLOWED;
}

/** Minutes between two instants, rounded down, never negative. */
export function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));
}

/** "4 min", "1 h 05 min". */
export function waitLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

// ---------------------------------------------------------------------------
// Recalls
// ---------------------------------------------------------------------------

export type RecallKind = 'checkup' | 'cleaning' | 'continue' | 'review';

export const RECALL_KINDS: readonly RecallKind[] = ['checkup', 'cleaning', 'continue', 'review'];

/** Generic words only: a recall is never a diagnosis. */
export const RECALL_LABEL: Record<RecallKind, string> = {
  checkup: 'Check-up',
  cleaning: 'Cleaning',
  continue: 'Continue treatment',
  review: 'Review',
};

/** The usual gap, used to pre-fill the date. Staff can change it; the owner can change the gaps in Settings → Clinic (Sprint 8). */
export const DEFAULT_RECALL_DAYS: Record<RecallKind, number> = { checkup: 182, cleaning: 182, continue: 7, review: 30 };

export function defaultDueOn(kind: RecallKind, today: string, days: Record<RecallKind, number> = DEFAULT_RECALL_DAYS): string {
  return addDays(today, days[kind]);
}

/** Settings form: whole days, 1 to 1,095 (3 years, the longest a come-back can be). */
export function checkRecallDays(raw: Record<string, string>): { ok: true; value: Record<RecallKind, number> } | { ok: false; fieldErrors: Record<string, string> } {
  const value = { ...DEFAULT_RECALL_DAYS };
  const errors: Record<string, string> = {};
  for (const k of RECALL_KINDS) {
    const v = (raw[k] ?? '').trim();
    if (!/^\d{1,4}$/.test(v) || Number(v) < 1 || Number(v) > 1095) errors[k] = `${RECALL_LABEL[k]}: 1 to 1,095 days.`;
    else value[k] = Number(v);
  }
  return Object.keys(errors).length ? { ok: false, fieldErrors: errors } : { ok: true, value };
}

export function isRecallKind(v: string): v is RecallKind {
  return (RECALL_KINDS as readonly string[]).includes(v);
}

export type RecallBucket = 'overdue' | 'today' | 'this_week' | 'later';

export function recallBucket(dueOn: string, today: string): RecallBucket {
  if (dueOn < today) return 'overdue';
  if (dueOn === today) return 'today';
  if (dueOn <= addDays(today, 7)) return 'this_week';
  return 'later';
}

/** The next-visit reminder. No treatment named: "your next visit", never the procedure. */
export function recallReminderText(r: { firstName: string; branchName: string; branchPhone: string | null; overdue: boolean }): string {
  const lines = [
    `Namaste ${r.firstName},`,
    r.overdue
      ? `This is a reminder from ${r.branchName}: your next visit with us was due. We'd be happy to see you.`
      : `This is a reminder from ${r.branchName}: your next visit with us is due soon.`,
    r.branchPhone ? `Please call us on ${r.branchPhone} to book a time. Thank you!` : 'Please call or drop in to book a time. Thank you!',
  ];
  return lines.join('\n');
}

/**
 * "in about 6 months", "in 1 week", "today": shown beside a recall's due date so
 * a default like 9 May 2027 explains itself (QA 9 Nov: it looked arbitrary).
 */
export function dueInWords(today: string, dueOn: string): string {
  const days = Math.round((Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return days === 0 ? 'today' : 'overdue';
  if (days === 1) return 'tomorrow';
  if (days < 14) return days % 7 === 0 ? `in ${days / 7} week${days === 7 ? '' : 's'}` : `in ${days} days`;
  if (days < 60) return `in about ${Math.round(days / 7)} weeks`;
  const months = Math.round(days / 30.44);
  return `in about ${months} month${months === 1 ? '' : 's'}`;
}
