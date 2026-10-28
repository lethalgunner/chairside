import Link from 'next/link';
import { requireContext } from '@/lib/auth';
import { add, formatINR } from '@/domain/money';
import { canDo, scopeBranchIds } from '@/services/context';
import { unbilledProcedures } from '@/services/reports';
import { Card, Empty, PageHead } from '@/components/ui';
import DismissForm from './DismissForm';

export default async function UnbilledPage() {
  const ctx = await requireContext();
  const rows = await unbilledProcedures(ctx, scopeBranchIds(ctx));
  const total = add(...rows.map((r) => r.valuePaise));
  const canDismiss = (branchId: string) => canDo(ctx, 'procedure.dismiss', branchId);
  return (
    <>
      <PageHead
        title="Done, not billed"
        sub={`Treatment recorded without a bill. Open the patient to bill it.${rows.some((r) => canDismiss(r.branchId)) ? ' If it was never done, remove it with a reason.' : ''}`}
      />
      <Card title={`${rows.length} procedure${rows.length === 1 ? '' : 's'} · ${formatINR(total)}`} flush>
        {rows.length === 0 ? (
          <Empty>Everything recorded has been billed.</Empty>
        ) : (
          <div className="tablewrap">
            <table className="stack-table">
              <thead>
                <tr>
                  <th scope="col">Patient</th>
                  <th scope="col">Procedure</th>
                  <th scope="col">Doctor</th>
                  <th scope="col">Branch</th>
                  <th scope="col">Recorded</th>
                  <th scope="col" className="num">Value</th>
                  <th scope="col"><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.procedureId}>
                    <td data-label="Patient" className="strong"><Link className="link" href={`/patients/${r.patientId}`}>{r.patientName}</Link></td>
                    <td data-label="Procedure">{r.itemName}</td>
                    <td data-label="Doctor">{r.doctorName}</td>
                    <td data-label="Branch">{r.branchName}</td>
                    <td data-label="Recorded" className="mono small">{r.performedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                    <td data-label="Value" className="num strong">{formatINR(r.valuePaise)}</td>
                    <td className="row-actions unbilled-actions">
                      {ctx.activeBranchId !== 'all' ? <Link className="link" href={`/bills/new?patient=${r.patientId}`}>Bill</Link> : null}
                      {canDismiss(r.branchId) ? <DismissForm procedureId={r.procedureId} itemName={r.itemName} /> : null}
                    </td>
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
