import Link from 'next/link';
import { requireContext } from '@/lib/auth';
import { displayDate } from '@/domain/dates';
import { formatINR } from '@/domain/money';
import { scopeBranchIds } from '@/services/context';
import { listInvoices } from '@/services/invoices';
import { Card, Empty, PageHead, StatusPill } from '@/components/ui';

export default async function InvoicesPage() {
  const ctx = await requireContext();
  const rows = await listInvoices(ctx, { branchIds: scopeBranchIds(ctx), limit: 200 });
  const multi = ctx.activeBranchId === 'all';
  return (
    <>
      <PageHead title="Bills" sub="Newest first. Test series: these are not legal invoices during the pilot." />
      <Card title={`${rows.length} bill${rows.length === 1 ? '' : 's'}`} flush>
        {rows.length === 0 ? (
          <Empty action={{ href: '/patients', label: 'Find a patient to bill' }}>No bills yet.</Empty>
        ) : (
          <div className="tablewrap">
            <table>
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
                    <td><Link className="link mono" href={`/invoices/${r.id}`}>{r.number}</Link></td>
                    <td>{displayDate(r.issuedOn)}</td>
                    {multi ? <td>{r.branchName}</td> : null}
                    <td><Link className="link" href={`/patients/${r.patientId}`}>{r.patientName}</Link></td>
                    <td><StatusPill status={r.status} /></td>
                    <td className="num">{formatINR(r.totalPaise)}</td>
                    <td className="num muted">{formatINR(r.paidPaise)}</td>
                    <td className={`num${r.duePaise > 0 ? ' strong due-text' : ' muted'}`}>{r.duePaise > 0 ? formatINR(r.duePaise) : '—'}</td>
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
