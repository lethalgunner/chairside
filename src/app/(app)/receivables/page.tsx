import Link from 'next/link';
import { requireContext } from '@/lib/auth';
import { businessDate, displayDate } from '@/domain/dates';
import { formatINR } from '@/domain/money';
import { scopeBranchIds } from '@/services/context';
import { receivables } from '@/services/reports';
import { Card, Empty, PageHead, Tile } from '@/components/ui';

function daysSince(iso: string, today: string): number {
  return Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000);
}

export default async function ReceivablesPage() {
  const ctx = await requireContext();
  const today = businessDate();
  const { rows, ageing } = await receivables(ctx, scopeBranchIds(ctx), today);
  return (
    <>
      <PageHead title="Receivables" sub="Open bills, oldest first: the order to follow up." />
      <div className="tiles">
        <Tile k={formatINR(ageing.current, { paise: false })} l="0–30 days" />
        <Tile k={formatINR(ageing.days31to60, { paise: false })} l="31–60 days" />
        <Tile k={formatINR(ageing.days61to90, { paise: false })} l="61–90 days" />
        <Tile k={formatINR(ageing.over90, { paise: false })} l="Over 90 days" tone={ageing.over90 > 0 ? 'alert' : undefined} />
      </div>
      <Card title={`${rows.length} open bill${rows.length === 1 ? '' : 's'} · ${formatINR(ageing.total)}`} flush>
        {rows.length === 0 ? (
          <Empty>No one owes anything.</Empty>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Patient</th>
                  <th scope="col">Bill</th>
                  <th scope="col">Branch</th>
                  <th scope="col">Date</th>
                  <th scope="col" className="num">Days</th>
                  <th scope="col" className="num">Total</th>
                  <th scope="col" className="num">Due</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="strong"><Link className="link" href={`/patients/${r.patientId}`}>{r.patientName}</Link></td>
                    <td><Link className="link mono" href={`/invoices/${r.id}`}>{r.number}</Link></td>
                    <td>{r.branchName}</td>
                    <td>{displayDate(r.issuedOn)}</td>
                    <td className="num">{daysSince(r.issuedOn, today)}</td>
                    <td className="num">{formatINR(r.totalPaise)}</td>
                    <td className="num strong due-text">{formatINR(r.duePaise)}</td>
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
