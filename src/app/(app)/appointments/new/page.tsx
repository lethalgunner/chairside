import Link from 'next/link';
import { requireContext } from '@/lib/auth';
import { businessDate, isIsoDate, shortDay } from '@/domain/dates';
import { formatIndianMobile } from '@/domain/phone';
import { doctorDays, getAppointment } from '@/services/appointments';
import { listCatalogue } from '@/services/catalogue';
import { canDo } from '@/services/context';
import { getPatient, searchPatients } from '@/services/patients';
import { Card, Empty, PageHead } from '@/components/ui';
import BookingForm from './BookingForm';

type Search = { patient?: string; date?: string; doctor?: string; time?: string; move?: string; q?: string };
const one = (v: unknown) => (typeof v === 'string' ? v : '');

/** Book (or move) an appointment (Sprint 4, LET-167). Free slots come from the server for the chosen day. */
export default async function NewAppointmentPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const branch = ctx.activeBranchId === 'all' ? null : ctx.activeBranchId;
  if (!branch || !canDo(ctx, 'appointment.manage', branch)) {
    return (
      <>
        <PageHead title="Book appointment" />
        <div className="callout warn">Pick the branch the appointment is at in the branch menu first.</div>
      </>
    );
  }
  const today = businessDate();
  const moving = one(sp.move) ? await getAppointment(ctx, one(sp.move)) : null;
  if (one(sp.move) && (!moving || moving.branchId !== branch)) {
    return (
      <>
        <PageHead title="Move appointment" />
        <Empty action={{ href: '/appointments', label: 'Back to appointments' }}>That appointment isn’t at this branch, or can’t be found.</Empty>
      </>
    );
  }
  const patientId = moving?.patientId ?? one(sp.patient);
  const patient = patientId ? await getPatient(ctx, patientId) : null;
  const date = isIsoDate(one(sp.date)) && one(sp.date) >= today ? one(sp.date) : moving && moving.date >= today ? moving.date : today;
  const docs = await doctorDays(ctx, branch, date);
  const doctor = docs.find((d) => d.providerId === one(sp.doctor))?.providerId ?? moving?.providerId ?? (docs.length === 1 ? docs[0]!.providerId : '');
  const time = /^\d{2}:\d{2}$/.test(one(sp.time)) ? one(sp.time) : '';

  if (!patient) {
    const q = one(sp.q).trim();
    const results = q.length >= 2 ? await searchPatients(ctx, q, 10) : [];
    const keep = new URLSearchParams({ ...(isIsoDate(one(sp.date)) ? { date } : {}), ...(doctor ? { doctor } : {}), ...(time ? { time } : {}) });
    return (
      <>
        <PageHead title="Book appointment" sub={time ? `${shortDay(date)} at ${time}` : undefined} />
        <Card title="Who is it for?">
          <form method="get" className="inline-form">
            {[...keep].map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <label htmlFor="appt-q">Name, mobile or file number</label>
            <input id="appt-q" name="q" defaultValue={q} autoFocus autoComplete="off" />
            <button type="submit" className="secondary-btn">Find</button>
          </form>
          {q.length >= 2 && results.length === 0 ? <p className="muted small">No patient matches “{q}”. <Link className="link" href="/patients/new">Register a new patient</Link> first.</p> : null}
          <ul className="plain pick-list">
            {results.map((p) => (
              <li key={p.id}>
                <Link href={`/appointments/new?${new URLSearchParams({ ...Object.fromEntries(keep), patient: p.id })}`}>
                  <span>{p.fullName}</span> <span className="muted small">{formatIndianMobile(p.phone)} · {p.fileNumbers.join(', ') || 'no file'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHead eyebrow={patient.fileNumbers.join(' · ')} title={moving ? `Move ${patient.fullName}’s appointment` : `Book for ${patient.fullName}`} sub={moving ? `Now ${shortDay(moving.date)} at ${moving.time} with ${moving.providerName}` : formatIndianMobile(patient.phone)} />
      {docs.length === 0 ? (
        <div className="callout warn">No doctors work at this branch yet. The owner sets this in Settings → Doctors.</div>
      ) : (
        <BookingForm
          patientId={patient.id}
          moveId={moving?.id ?? null}
          today={today}
          date={date}
          doctorId={doctor}
          time={time || (moving && moving.date === date && moving.providerId === doctor ? moving.time : '')}
          reason={moving?.reason ?? ''}
          minutes={moving?.minutes ?? 0}
          doctors={docs}
          treatments={(await listCatalogue(ctx, branch)).filter((c) => c.defaultMinutes).map((c) => ({ id: c.id, name: c.name, minutes: c.defaultMinutes! }))}
        />
      )}
    </>
  );
}
