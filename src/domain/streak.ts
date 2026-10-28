/**
 * Day-close streak (Sprint 2, T35). Pure and unit-tested.
 *
 * Counts consecutive days with activity that were closed, walking back from
 * the most recent. A day with no activity (clinic shut, Sunday) is skipped,
 * the same rule as the pilot scorecard. Today does not break the streak while
 * it is still open: the day isn't over.
 *
 * It counts closes, never zero variance. Rewarding an exact drawer would
 * reward fudged counts, and a variance is information (support manual §6.9).
 */
export interface StreakDay {
  /** ISO date. */
  date: string;
  active: boolean;
  closed: boolean;
}

export function closeStreak(days: StreakDay[], today: string): number {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  let n = 0;
  for (const d of sorted) {
    if (d.date > today) continue;
    if (d.closed) {
      n++;
      continue;
    }
    if (!d.active) continue;
    if (d.date === today) continue;
    break;
  }
  return n;
}
