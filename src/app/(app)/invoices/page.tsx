import Link from 'next/link';
import { requireContext } from '@/lib/auth';
import { businessDate, displayDate, resolveViewDate, shortDay } from '@/domain/dates';
import { formatINR, type Paise } from '@/domain/money';
import { scopeBranchIds } from '@/services/context';
import { listInvoices } from '@/services/invoices';
import { dayTotals } from '@/services/reports';
import { Card, Empty, MODE_LABEL, PageHead, StatusPill } from '@/components/ui';
import DayNav from '@/components/DayNav';

/**
 * Bills, newest first. "Today" (or any `?date=`, Q19/T27) narrows the list to
 * one business day and adds that day's subtotal, so the desk can match it
 * against the old system line by line. "All" is the full list.
 */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ date?: string | string[] }> }) {
  const ctx = await requireContext();
  const today = businessDate();
  const raw = (await searchParams).date;
  const day = raw === undefined ? null : resolveViewDate(raw, today);
  const branchIds = scopeBranchIds(ctx);
  const [rows, totals] = await Promise.all([
    listInvoices(ctx, { branchIds, limit: day ? 1000 : 200, issuedOn: day?.date }),
    day ? dayTotals(ctx, branchIds, day.date) : Promise.resolve(null),
  ]);
  const multi = ctx.activeBranchId === 'all';
  const dayLabel = day ? (day.isToday ? 'today' : `on ${shortDay(day.date)}`) : '';
  const modes = totals ? Object.entries(totals.byMode).filter(([, v]) => v !== 0) : [];
  return (
    <>
      <PageHead title="Bills" sub="Newest first. Test series: these are not legal invoices during the pilot." />
      <nav className="filter-tabs" aria-label="Which bills">
        <Link href={`/invoices?date=${today}`} className={day?.isToday ? 'on' : undefined} aria-current={day?.isToday ? 'page' : undefined}>
          Today
        </Link>
        <Link href="/invoices" className={day ? undefined : 'on'} aria-current={day ? undefined : 'page'}>
          All
        </Link>
      </nav>
      {day ? <DayNav date={day.date} today={today} isToday={day.isToday} href={(d) => `/invoices?date=${d ?? today}`} /> : null}
      {day && totals ? (
        <p className="day-subtotal">
          <strong>{totals.billCount} bill{totals.billCount === 1 ? '' : 's'}</strong> · {formatINR(totals.billedPaise)} billed{' '}
          <span className="muted">(cancelled bills not counted)</span>
          <br />
          Collected {dayLabel}:{' '}
          {modes.length === 0 ? (
            'nothing yet'
          ) : (
            <>
              {modes.map(([m, v]) => `${MODE_LABEL[m] ?? m} ${formatINR(v as Paise)}`).join(' · ')} · <strong>Total {formatINR(totals.collectedPaise)}</strong>
            </>
          )}
        </p>
      ) : null}
      <Card title={`${rows.length} bill${rows.length === 1 ? '' : 's'}${day ? ` ${dayLabel}` : ''}`} flush>
        {rows.length === 0 ? (
          day ? (
            <Empty>No bills {dayLabel}.</Empty>
          ) : (
            <Empty action={{ href: '/patients', label: 'Find a patient to bill' }}>No bills yet.</Empty>
          )
        ) : (
          <div className="tablewrap">
            <table className="stack-table">
              <thead>
                <tr>
                  <th scope="col">Bill</th>
                  <th scope="col">Date</th>
                  {multi ? <th scope="col">Branch</th> : null}
                  <th scope="col">Patient</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">Total</th>
                  <th scope="col" className="num">Paid</th>
                  <th scope="col" className="num">Due</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Bill"><Link className="link mono" href={`/invoices/${r.id}`}>{r.number}</Link></td>
                    <td data-label="Date">{displayDate(r.issuedOn)}</td>
                    {multi ? <td data-label="Branch">{r.branchName}</td> : null}
                    <td data-label="Patient"><Link className="link" href={`/patients/${r.patientId}`}>{r.patientName}</Link></td>
                    <td data-label="Status"><StatusPill status={r.status} /></td>
                    <td data-label="Total" className="num">{formatINR(r.totalPaise)}</td>
                    <td data-label="Paid" className="num muted">{formatINR(r.paidPaise)}</td>
                    <td data-label="Due" className={`num${r.duePaise > 0 ? ' strong due-text' : ' muted'}`}>{r.duePaise > 0 ? formatINR(r.duePaise) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
