import Link from 'next/link';
import { requireContext } from '@/lib/auth';
import { APPOINTMENT_LABEL } from '@/domain/appointments';
import { addDays, businessDate, isIsoDate, shortDay } from '@/domain/dates';
import { dayAppointments, doctorDays } from '@/services/appointments';
import { canAnywhere, canDo, scopeBranchIds } from '@/services/context';
import { Card, Empty, PageHead } from '@/components/ui';
import AppointmentActions from './AppointmentActions';

/** One clinic day by doctor (Sprint 4, LET-167): what's booked, and free slots to book. */
export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<{ date?: string | string[] }> }) {
  const ctx = await requireContext();
  if (!canAnywhere(ctx, 'appointment.manage') && !canAnywhere(ctx, 'report.branch')) {
    return (
      <>
        <PageHead title="Appointments" />
        <Empty>Appointments are for the front desk, managers and doctors.</Empty>
      </>
    );
  }
  const { date: raw } = await searchParams;
  const today = businessDate();
  const date = typeof raw === 'string' && isIsoDate(raw) ? raw : today;
  const branch = ctx.activeBranchId === 'all' ? null : ctx.activeBranchId;
  const canBook = branch ? canDo(ctx, 'appointment.manage', branch) : false;
  const [rows, docs] = await Promise.all([dayAppointments(ctx, scopeBranchIds(ctx), date), branch ? doctorDays(ctx, branch, date) : Promise.resolve([])]);
  const shown = new Set(docs.map((d) => d.providerId));
  const others = rows.filter((r) => !shown.has(r.providerId));
  const active = rows.filter((r) => r.status !== 'cancelled');
  const q = (d: string) => `/appointments?date=${d}`;

  return (
    <>
      <PageHead
        title="Appointments"
        sub={`${date === today ? 'Today, ' : ''}${shortDay(date)} · ${active.length} booked${rows.length - active.length ? ` · ${rows.length - active.length} cancelled` : ''}`}
        right={
          <nav className="day-nav" aria-label="Pick a day">
            <Link className="secondary" href={q(addDays(date, -1))} aria-label="Previous day">←</Link>
            {date !== today ? <Link className="secondary" href={q(today)}>Today</Link> : null}
            <Link className="secondary" href={q(addDays(date, 1))} aria-label="Next day">→</Link>
            <form method="get" className="inline-form">
              <label className="sr-only" htmlFor="appt-date">Date</label>
              <input id="appt-date" type="date" name="date" defaultValue={date} />
              <button type="submit" className="secondary-btn">Go</button>
            </form>
          </nav>
        }
      />
      {!branch ? <div className="callout">Showing every branch. Pick a branch in the branch menu to see free slots and book.</div> : null}
      {branch && docs.length === 0 ? <div className="callout warn">No doctors work at this branch yet. The owner sets this in Settings → Doctors.</div> : null}

      <div className="appt-grid">
        {docs.map((d) => {
          const mine = rows.filter((r) => r.providerId === d.providerId);
          return (
            <Card key={d.providerId} title={d.name} note={d.hours ? `${d.hours.startTime}–${d.hours.endTime} · ${d.slotMinutes} min` : 'Not working this day'}>
              <span className="doc-dot" style={{ background: d.colour ?? 'var(--line-strong)' }} aria-hidden="true" />
              {mine.length === 0 ? <p className="muted small">Nothing booked.</p> : null}
              <ul className="plain appt-list">
                {mine.map((r) => (
                  <li key={r.id} className={`appt s-${r.status}`}>
                    <span className="mono strong">{r.time}</span>
                    <span>
                      <Link className="link" href={`/patients/${r.patientId}`}>{r.patientName}</Link>
                      {r.reason ? <span className="muted small"> · {r.reason}</span> : null}
                      <span className="muted small"> · {r.minutes} min</span>
                    </span>
                    <span className={`pill${r.status === 'no_show' || r.status === 'cancelled' ? ' credit' : r.status === 'arrived' || r.status === 'completed' ? ' paid' : ''}`}>{APPOINTMENT_LABEL[r.status]}</span>
                    {canDo(ctx, 'appointment.manage', r.branchId) ? <AppointmentActions id={r.id} status={r.status} isToday={date === today} label={`${r.time} ${r.patientName}`} /> : null}
                  </li>
                ))}
              </ul>
              {canBook && d.free.length > 0 ? (
                <div className="free-slots">
                  <div className="muted small">Free: tap a time to book</div>
                  <div className="chips">
                    {d.free.map((t) => (
                      <Link key={t} className="chip" href={`/appointments/new?date=${date}&doctor=${d.providerId}&time=${t}`} aria-label={`Book ${d.name} at ${t}`}>{t}</Link>
                    ))}
                  </div>
                </div>
              ) : canBook && d.hours && date >= today ? (
                <p className="muted small">Fully booked.</p>
              ) : null}
            </Card>
          );
        })}
        {others.length > 0 ? (
          <Card title={branch ? 'Other doctors' : 'All appointments'}>
            <ul className="plain appt-list">
              {others.map((r) => (
                <li key={r.id} className={`appt s-${r.status}`}>
                  <span className="mono strong">{r.time}</span>
                  <span>
                    <Link className="link" href={`/patients/${r.patientId}`}>{r.patientName}</Link>
                    <span className="muted small"> · {r.providerName}</span>
                  </span>
                  <span className="pill">{APPOINTMENT_LABEL[r.status]}</span>
                  {canDo(ctx, 'appointment.manage', r.branchId) && branch === r.branchId ? <AppointmentActions id={r.id} status={r.status} isToday={date === today} label={`${r.time} ${r.patientName}`} /> : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
      {canBook ? (
        <p className="muted small">To book for a patient, open their page and press <strong>Book appointment</strong>, or tap a free time above.</p>
      ) : null}
    </>
  );
}
