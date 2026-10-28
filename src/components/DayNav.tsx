import Link from 'next/link';
import { addDays, MAX_DAYS_BACK, shortDay } from '@/domain/dates';

/**
 * Move between business days on a read-only view (Q19, T27). Plain links and a
 * GET form, so it works without JavaScript. `href(null)` is the page's
 * today link; `href(date)` any other day. Dates outside the allowed window are
 * never offered, and the server re-validates whatever arrives.
 */
export default function DayNav({ date, today, isToday, href }: { date: string; today: string; isToday: boolean; href: (date: string | null) => string }) {
  const earliest = addDays(today, -MAX_DAYS_BACK);
  const prev = addDays(date, -1);
  const next = addDays(date, 1);
  return (
    <>
      <nav className="day-nav" aria-label="Choose a day">
        {prev >= earliest ? (
          <Link className="link" href={href(prev)}>
            <span aria-hidden="true">← </span>Previous day
          </Link>
        ) : null}
        {!isToday ? (
          <Link className="link" href={href(next === today ? null : next)}>
            Next day<span aria-hidden="true"> →</span>
          </Link>
        ) : null}
        <form method="get" className="day-pick">
          <label htmlFor="day-pick">Go to day</label>
          <input id="day-pick" type="date" name="date" defaultValue={date} min={earliest} max={today} required />
          <button type="submit" className="secondary-btn">Show</button>
        </form>
        {!isToday ? (
          <Link className="link strong" href={href(null)}>
            Back to today
          </Link>
        ) : null}
      </nav>
      {!isToday ? (
        <div className="callout warn past-day" role="status">
          Viewing <strong>{shortDay(date)}</strong> (read-only)
        </div>
      ) : null}
    </>
  );
}
