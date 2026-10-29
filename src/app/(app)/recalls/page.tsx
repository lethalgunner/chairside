import Link from 'next/link';
import { requireContext } from '@/lib/auth';
import { businessDate, displayDate } from '@/domain/dates';
import { RECALL_LABEL, type RecallBucket } from '@/domain/visits';
import { remindedLabel } from '@/domain/whatsapp';
import { canAnywhere, canDo, scopeBranchIds } from '@/services/context';
import { openRecalls } from '@/services/recalls';
import { Card, Empty, PageHead } from '@/components/ui';
import RemindButton from '@/components/RemindButton';
import { CloseRecall } from '../patients/[id]/FrontDesk';

const BUCKETS: { key: RecallBucket; title: string }[] = [
  { key: 'overdue', title: 'Overdue' },
  { key: 'today', title: 'Due today' },
  { key: 'this_week', title: 'Due this week' },
];

/** Next-visit recalls due this week or overdue (Sprint 3, T37). Oldest first: the order to call. */
export default async function RecallsPage() {
  const ctx = await requireContext();
  if (!canAnywhere(ctx, 'patient.view')) {
    return (
      <>
        <PageHead title="Recalls" />
        <Empty>Recalls are for the front desk and doctors.</Empty>
      </>
    );
  }
  const today = businessDate();
  const rows = await openRecalls(ctx, { branchIds: scopeBranchIds(ctx), horizonDays: 7, today });
  const multi = new Set(rows.map((r) => r.branchId)).size > 1;
  return (
    <>
      <PageHead title="Recalls" sub="Patients whose next visit is due this week or overdue. Set a next visit on the patient’s page." />
      {rows.length === 0 ? (
        <Card title="Nothing due">
          <Empty>No recalls due this week. Set one from a patient’s page under “Next visit”.</Empty>
        </Card>
      ) : null}
      {BUCKETS.map(({ key, title }) => {
        const list = rows.filter((r) => r.bucket === key);
        if (list.length === 0) return null;
        return (
          <Card key={key} title={`${title} · ${list.length}`} flush>
            <div className="tablewrap">
              <table className="stack-table">
                <thead>
                  <tr>
                    <th scope="col">Patient</th>
                    {multi ? <th scope="col">Branch</th> : null}
                    <th scope="col">For</th>
                    <th scope="col">Due</th>
                    <th scope="col">Follow up</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id}>
                      <td data-label="Patient" className="strong"><Link className="link" href={`/patients/${r.patientId}`}>{r.patientName}</Link></td>
                      {multi ? <td data-label="Branch">{r.branchName}</td> : null}
                      <td data-label="For">{RECALL_LABEL[r.kind]}</td>
                      <td data-label="Due">{displayDate(r.dueOn)}</td>
                      <td data-label="Follow up" className="follow-up">
                        {canDo(ctx, 'patient.remind', r.branchId) ? (
                          <RemindButton
                            compact
                            recallId={r.id}
                            patientId={r.patientId}
                            branchId={r.branchId}
                            href={r.href}
                            amountLabel={`${r.patientName}’s next visit`}
                            lastLabel={r.lastRemindedAt ? `${remindedLabel(r.lastRemindedAt)}${r.remindCount > 1 ? ` (${r.remindCount} times)` : ''}` : null}
                            confirmOldSystem={false}
                          />
                        ) : null}{' '}
                        {canDo(ctx, 'recall.manage', r.branchId) ? <CloseRecall recallId={r.id} label={`${RECALL_LABEL[r.kind]} for ${r.patientName}`} /> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
    </>
  );
}
