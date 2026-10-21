/**
 * Business dates. Clinics run on Indian Standard Time while servers run on UTC,
 * so "today" is always computed in Asia/Kolkata — otherwise a bill raised at
 * 00:30 IST lands on the previous day, and on 1 April in the previous FY.
 */

const IST = 'Asia/Kolkata';

/** YYYY-MM-DD for the given instant, in IST. */
export function businessDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Indian financial year (April–March) for an ISO date, e.g. '2026-27'. */
export function financialYear(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new Error(`Not an ISO date: '${isoDate}'`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** Two-digit form used inside document numbers, e.g. '26-27'. */
export function financialYearShort(isoDate: string): string {
  const fy = financialYear(isoDate);
  return `${fy.slice(2, 4)}-${fy.slice(5, 7)}`;
}

/** Age today, given an age recorded on an earlier date. Never negative. */
export function ageNow(age: number | null, recordedOn: string | null, today: string): number | null {
  if (age === null) return null;
  if (!recordedOn) return age;
  const years = Number(today.slice(0, 4)) - Number(recordedOn.slice(0, 4));
  const beforeAnniversary = today.slice(5) < recordedOn.slice(5);
  return Math.max(0, age + years - (beforeAnniversary ? 1 : 0));
}

/** '2026-10-17' → '17 Oct 2026'. */
export function displayDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(d)} ${months[Number(m) - 1] ?? m} ${y}`;
}

/** Shift an ISO date by whole days: addDays('2026-03-01', -1) === '2026-02-28'. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Not an ISO date: '${isoDate}'`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
