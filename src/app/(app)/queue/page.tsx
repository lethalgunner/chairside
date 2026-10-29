import Link from 'next/link';
import { requireContext } from '@/lib/auth';
import { businessDate, displayDate, istTime } from '@/domain/dates';
import { minutesBetween, VISIT_LABEL, waitLabel } from '@/domain/visits';
import { canAnywhere, canDo, scopeBranchIds } from '@/services/context';
import { queueFor } from '@/services/visits';
import { Card, Empty, PageHead } from '@/components/ui';
import AutoRefresh from '@/components/AutoRefresh';
import VisitActions from './VisitActions';

const PILL: Record<string, string> = { waiting: 'due', in_chair: 'tax12', done: 'paid', left: 'credit' };

/** Today's waiting room (Sprint 3, T36). */
export default async function QueuePage() {
  const ctx = await requireContext();
  if (!canAnywhere(ctx, 'patient.view')) {
    return (
      <>
        <PageHead title="Waiting room" />
        <Empty>The waiting room is for the front desk and doctors.</Empty>
      </>
    );
  }
  const today = businessDate();
  const now = new Date();
  const rows = await queueFor(ctx, scopeBranchIds(ctx), today);
  const active = rows.filter((r) => r.status === 'waiting' || r.status === 'in_chair');
  const finished = rows.filter((r) => r.status === 'done' || r.status === 'left');
  const seenNotBilled = rows.filter((r) => r.seenNotBilled);
  const multi = new Set(rows.map((r) => r.branchId)).size > 1;
  const waiting = rows.filter((r) => r.status === 'waiting').length;
  const inChair = rows.filter((r) => r.status === 'in_chair').length;

  const table = (list: typeof rows, caption: string) => (
    <div className="tablewrap">
      <table className="stack-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Token</th>
            <th scope="col">Patient</th>
            {multi ? <th scope="col">Branch</th> : null}
            <th scope="col">Status</th>
            <th scope="col">Time</th>
            <th scope="col"><span className="sr-only">Next step</span></th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => {
            const waited = minutesBetween(r.arrivedAt, r.seatedAt ?? r.doneAt ?? now);
            return (
              <tr key={r.id}>
                <td data-label="Token" className="token">{r.token}</td>
                <td data-label="Patient" className="strong"><Link className="link" href={`/patients/${r.patientId}`}>{r.patientName}</Link></td>
                {multi ? <td data-label="Branch">{r.branchName}</td> : null}
                <td data-label="Status"><span className={`pill ${PILL[r.status]}`}>{VISIT_LABEL[r.status]}</span></td>
                <td data-label="Time" className="small">
                  Arrived {istTime(r.arrivedAt)}
                  {r.status === 'waiting' ? ` · waiting ${waitLabel(waited)}` : r.seatedAt ? ` · seated after ${waitLabel(waited)}` : ''}
                </td>
                <td className="row-actions">{canDo(ctx, 'visit.manage', r.branchId) ? <VisitActions visitId={r.id} status={r.status} token={r.token} /> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHead
        eyebrow={displayDate(today)}
        title="Waiting room"
        sub={`${waiting} waiting · ${inChair} in the chair · ${finished.length} finished`}
        right={
          ctx.activeBranchId !== 'all' && canDo(ctx, 'visit.manage', ctx.activeBranchId) ? (
            <Link className="cta" href="/patients">
              Add a patient
            </Link>
          ) : null
        }
      />
      {seenNotBilled.length > 0 ? (
        <div className="callout warn" role="status">
          <strong>Seen, not billed:</strong>{' '}
          {seenNotBilled.map((r, i) => (
            <span key={r.id}>
              {i > 0 ? ', ' : ''}
              {canDo(ctx, 'invoice.issue', r.branchId) && ctx.activeBranchId === r.branchId ? (
                <Link className="link" href={`/bills/new?patient=${r.patientId}`}>{r.patientName} (token {r.token})</Link>
              ) : (
                <Link className="link" href={`/patients/${r.patientId}`}>{r.patientName} (token {r.token})</Link>
              )}
            </span>
          ))}
          . Marked done with nothing billed or recorded today. Bill them, or record the work as unbilled.
        </div>
      ) : null}
      <Card title="Now" flush>
        {active.length === 0 ? <Empty>No one is waiting. Find a patient and press “Add to today’s queue”.</Empty> : table(active, 'Waiting and in the chair')}
      </Card>
      {finished.length > 0 ? (
        <Card title="Finished today" flush>
          {table(finished, 'Finished today')}
        </Card>
      ) : null}
    </>
  );
}
