/**
 * The Pilot 0 scorecard (Sprint 1, T26): the five measures the parallel run is
 * judged on, computed from figures Chairside already holds. Pure: no database,
 * no clock. Counts and milliseconds are integers; percentages and seconds are
 * only formatted for display (rounded DOWN, so a shown figure never looks like
 * a pass when the underlying number is not).
 */
import { addDays } from './dates';
import type { Paise } from './money';
import { compareWithLegacy } from './parallel';

/** Pass thresholds, as agreed for the five-day parallel run. */
export const THRESHOLDS = {
  /** Criterion 1: covered ÷ old bills ≥ 80 %. */
  billSharePct: 80,
  /** Criterion 2: day totals match on ≥ 4 of every 5 days with activity. */
  matchedDays: { of: 5, need: 4 },
  /** Criterion 3: median registration strictly under 40 s. */
  registrationMedianMs: 40_000,
  /** Criterion 4: the owner opens the dashboard on ≥ 3 of every 5 days with activity. */
  dashboardDays: { of: 5, need: 3 },
} as const;

/** The default window: the last 5 business days ending today (IST calendar days). */
export const DEFAULT_WINDOW_DAYS = 5;
export const MAX_WINDOW_DAYS = 31;

/** One line each, shown on screen under the scorecard. */
export const DEFINITIONS = {
  billShare:
    'Old-system bills in Chairside: on each day with an old-system bill count, the smaller of Chairside’s bills and the old system’s, added up and divided by all old-system bills.',
  dayTotals: 'Day totals match: a day counts only when both the bill count and the amount collected equal the old system’s figures.',
  registration: 'Registration time: from opening the New patient form to saving it, middle value of all registrations (half were quicker, half slower).',
  dashboard: 'Owner opened the dashboard: days on which someone with the owner role opened it at least once.',
  closed: 'Days closed: days whose day close was completed, out of days with any bill, payment or day book. For information, no pass mark.',
  activity: 'A day with activity is one with a bill, a payment or a day book at that branch. Chairside bills are issued bills that were not cancelled.',
} as const;

/** One branch on one business date that had a bill, a payment or a day book. */
export interface ScoreDay {
  date: string;
  /** Chairside: issued bills that were not cancelled, on this business date. */
  billCount: number;
  /** Chairside: payments that were not cancelled. */
  collectedPaise: Paise;
  legacyBillCount: number | null;
  legacyCollectedPaise: Paise | null;
  closed: boolean;
}

export type Label = 'Pass' | 'Not yet' | 'No data' | 'For information';

export interface CriterionResult {
  key: 'billShare' | 'dayTotals' | 'registration' | 'dashboard' | 'closed';
  title: string;
  measured: string;
  threshold: string;
  label: Label;
}

/**
 * Criterion 1. Sum over days with an old-system bill count of
 * min(Chairside bills, old bills), divided by the sum of old bills. Taking the
 * smaller of the two per day stops a day with extra Chairside bills from
 * hiding a day with missing ones. Null when there is nothing to divide by.
 */
export function billShare(days: readonly ScoreDay[]): { covered: number; old: number } | null {
  let covered = 0;
  let old = 0;
  for (const d of days) {
    if (d.legacyBillCount === null) continue;
    covered += Math.min(d.billCount, d.legacyBillCount);
    old += d.legacyBillCount;
  }
  return old > 0 ? { covered, old } : null;
}

/** Criterion 2. A day is matched only when compareWithLegacy says `matches`. */
export function matchedDays(days: readonly ScoreDay[]): { matched: number; days: number } {
  const matched = days.filter(
    (d) =>
      compareWithLegacy({
        legacyBillCount: d.legacyBillCount,
        legacyCollectedPaise: d.legacyCollectedPaise,
        billCount: d.billCount,
        collectedPaise: d.collectedPaise,
      })?.matches === true,
  ).length;
  return { matched, days: days.length };
}

/** Middle value; the mean of the two middle values for an even count. Null when empty. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** "need of every `of`" scaled to `n` days, rounded up: 4-of-5 over 5 days → 4, over 3 days → 3, over 10 → 8. */
export function required(n: number, rule: { of: number; need: number }): number {
  return Math.ceil((n * rule.need) / rule.of);
}

/**
 * A duration from the browser, clamped to 0–30 minutes. Anything that is not
 * a finite number is ignored (null), so a missing or tampered value never
 * reaches the log.
 */
export const MAX_FORM_MS = 30 * 60 * 1000;
export function clampFormMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(MAX_FORM_MS, Math.max(0, Math.round(value)));
}

/** Percentage to one decimal, rounded down: 2 of 3 → "66.6%". */
export function pctDown(num: number, den: number): string {
  const tenths = Math.floor((num * 1000) / den);
  return `${Math.floor(tenths / 10)}.${tenths % 10}%`;
}

/** Seconds to one decimal, rounded down: 39 999 ms → "39.9 s". */
export function secondsDown(ms: number): string {
  const tenths = Math.floor(ms / 100);
  return `${Math.floor(tenths / 10)}.${tenths % 10} s`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface ScopeInput {
  /** One entry per branch-day with activity. For a total, every branch's days together. */
  days: readonly ScoreDay[];
  /** Registration durations in ms recorded in this scope and window. */
  registrationMs: readonly number[];
  /** Business dates (YYYY-MM-DD) on which an owner opened the dashboard. Org-wide. */
  ownerViewDates: ReadonlySet<string>;
  /** 'branch-days' for a total over several branches, so the counts say what they count. */
  unit?: 'days' | 'branch-days';
}

/** All five criteria for one branch, or for several branches together. */
export function scoreScope(input: ScopeInput): CriterionResult[] {
  const unit = input.unit ?? 'days';
  const u = (n: number) => plural(n, unit === 'days' ? 'day' : 'branch-day', unit === 'days' ? 'days' : 'branch-days');

  // 1. Old-system bills in Chairside.
  const share = billShare(input.days);
  const c1: CriterionResult = {
    key: 'billShare',
    title: 'Old-system bills also in Chairside',
    threshold: `${THRESHOLDS.billSharePct}% or more`,
    ...(share === null
      ? { measured: 'No old-system bill counts entered yet', label: 'No data' as const }
      : {
          measured: `${pctDown(share.covered, share.old)} (${share.covered} of ${plural(share.old, 'old-system bill', 'old-system bills')})`,
          // Integer comparison: covered / old ≥ 80 / 100.
          label: share.covered * 100 >= THRESHOLDS.billSharePct * share.old ? ('Pass' as const) : ('Not yet' as const),
        }),
  };

  // 2. Day totals match.
  const m = matchedDays(input.days);
  const need2 = required(m.days, THRESHOLDS.matchedDays);
  const c2: CriterionResult = {
    key: 'dayTotals',
    title: 'Day totals match the old system',
    threshold:
      m.days === 0
        ? `${THRESHOLDS.matchedDays.need} of every ${THRESHOLDS.matchedDays.of} days with activity`
        : `${need2} of ${u(m.days)} with activity (${THRESHOLDS.matchedDays.need} of every ${THRESHOLDS.matchedDays.of})`,
    ...(m.days === 0
      ? { measured: 'No days with activity', label: 'No data' as const }
      : { measured: `${m.matched} of ${u(m.days)} matched`, label: m.matched >= need2 ? ('Pass' as const) : ('Not yet' as const) }),
  };

  // 3. Registration median.
  const med = median(input.registrationMs);
  const c3: CriterionResult = {
    key: 'registration',
    title: 'Registration time (median)',
    threshold: `under ${THRESHOLDS.registrationMedianMs / 1000} s`,
    ...(med === null
      ? { measured: 'No registrations timed yet', label: 'No data' as const }
      : {
          measured: `${secondsDown(med)} (${plural(input.registrationMs.length, 'registration', 'registrations')})`,
          label: med < THRESHOLDS.registrationMedianMs ? ('Pass' as const) : ('Not yet' as const),
        }),
  };

  // 4. Owner opened the dashboard: calendar days (not branch-days), since it is one person's habit.
  const activeDates = [...new Set(input.days.map((d) => d.date))];
  const viewed = activeDates.filter((d) => input.ownerViewDates.has(d)).length;
  const need4 = required(activeDates.length, THRESHOLDS.dashboardDays);
  const c4: CriterionResult = {
    key: 'dashboard',
    title: 'Owner opened the dashboard',
    threshold:
      activeDates.length === 0
        ? `${THRESHOLDS.dashboardDays.need} of every ${THRESHOLDS.dashboardDays.of} days with activity`
        : `${need4} of ${plural(activeDates.length, 'day', 'days')} with activity (${THRESHOLDS.dashboardDays.need} of every ${THRESHOLDS.dashboardDays.of})`,
    ...(activeDates.length === 0
      ? { measured: 'No days with activity', label: 'No data' as const }
      : { measured: `${viewed} of ${plural(activeDates.length, 'day', 'days')}`, label: viewed >= need4 ? ('Pass' as const) : ('Not yet' as const) }),
  };

  // 5. Days closed: information only.
  const closed = input.days.filter((d) => d.closed).length;
  const c5: CriterionResult = {
    key: 'closed',
    title: 'Days closed',
    threshold: 'No pass mark',
    ...(input.days.length === 0
      ? { measured: 'No days with activity', label: 'No data' as const }
      : { measured: `${closed} of ${u(input.days.length)} with activity`, label: 'For information' as const }),
  };

  return [c1, c2, c3, c4, c5];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function isIsoDate(v: string): boolean {
  if (!ISO.test(v)) return false;
  try {
    return addDays(v, 0) === v; // rejects 2026-02-30
  } catch {
    return false;
  }
}

/** Days from `from` to `to` inclusive. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export interface ScoreWindow {
  from: string;
  to: string;
  /** Set when the requested range was refused and the default is shown instead. */
  error?: string;
}

/**
 * The date range from the form. Missing → the last 5 business days ending
 * today. Refused (with a reason, falling back to the default) when not a real
 * date, in the future, back to front, or longer than 31 days.
 */
export function parseWindow(req: { from?: string; to?: string }, today: string): ScoreWindow {
  const fallback = { from: addDays(today, -(DEFAULT_WINDOW_DAYS - 1)), to: today };
  const from = req.from?.trim() ?? '';
  const to = req.to?.trim() ?? '';
  if (!from && !to) return fallback;
  if (!isIsoDate(from) || !isIsoDate(to)) return { ...fallback, error: 'Enter both dates. Showing the last 5 days.' };
  if (to > today || from > today) return { ...fallback, error: 'The range cannot end in the future. Showing the last 5 days.' };
  if (from > to) return { ...fallback, error: 'The start date is after the end date. Showing the last 5 days.' };
  if (daysBetween(from, to) > MAX_WINDOW_DAYS) return { ...fallback, error: `Pick at most ${MAX_WINDOW_DAYS} days. Showing the last 5 days.` };
  return { from, to };
}
