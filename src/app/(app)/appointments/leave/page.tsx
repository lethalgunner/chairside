import Link from 'next/link';
import { requireContext } from '@/lib/auth';
import { businessDate, shortDay } from '@/domain/dates';
import { leaveWords } from '@/domain/leave';
import { leavePage } from '@/services/leave';
import { Card, Empty, PageHead } from '@/components/ui';
import LeaveForm, { RemoveLeave } from './LeaveForm';

/** Doctor leave (Sprint 8): record days away and see who still needs a call. */
export default async function LeavePage() {
  const ctx = await requireContext();
  const { doctors, leaves, toMove } = await leavePage(ctx);
  const today = businessDate();
  return (
    <>
      <PageHead
        eyebrow="Appointments"
        title="Doctor leave"
        sub="Days a doctor is away, at every branch. Those days show no free times and can't be booked. Appointments already booked stay put until you move them."
        right={<Link className="secondary" href="/appointments">← Appointments</Link>}
      />
      {doctors.length === 0 ? (
        <Empty>No doctors work at the branches you book for.</Empty>
      ) : (
        <LeaveForm doctors={doctors} today={today} />
      )}

      {toMove.length > 0 ? (
        <Card title="To move" note={`${toMove.length} booked while their doctor is away`} flush>
          <div className="tablewrap">
            <table className="stack-table">
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Time</th>
                  <th scope="col">Patient</th>
                  <th scope="col">Doctor</th>
                  <th scope="col">Branch</th>
                  <th scope="col"><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {toMove.map((a) => (
                  <tr key={a.id}>
                    <td data-label="Day">{shortDay(a.date)}</td>
                    <td data-label="Time" className="mono">{a.time}</td>
                    <td data-label="Patient"><Link className="link" href={`/patients/${a.patientId}`}>{a.patientName}</Link></td>
                    <td data-label="Doctor">{a.providerName}</td>
                    <td data-label="Branch">{a.branchName}</td>
                    <td data-label="Action"><Link className="link" href={`/appointments/new?move=${a.id}`} aria-label={`Move ${a.time} ${a.patientName}`}>Move</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card title="Coming up" flush>
        {leaves.length === 0 ? (
          <p className="muted small leave-list">No leave recorded.</p>
        ) : (
          <ul className="plain leave-list">
            {leaves.map((l) => (
              <li key={l.id}>
                <span className="strong">{l.providerName}</span> <span>{leaveWords(l)}</span>
                {l.note ? <span className="muted small"> · {l.note}</span> : null}
                {l.canRemove ? <RemoveLeave id={l.id} label={`${l.providerName} ${leaveWords(l)}`} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
