import { notFound } from 'next/navigation';
import { PageHead, Card, Initials } from '@/components/ui';
import { formatINR, subtract } from '@/domain/money';
import {
  PATIENTS,
  patientById,
  statementFor,
  balanceFor,
  invoicesForPatient,
  branchById,
} from '@/lib/seed';

export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, string> = {
  invoice: 'Invoice',
  receipt: 'Receipt',
  advance: 'Advance',
  advance_drawdown: 'Advance applied',
  credit_note: 'Credit note',
  refund: 'Refund',
  write_off: 'Write-off',
};

export default async function PatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ welcome?: string }>;
}) {
  const { id } = await params;
  const { welcome } = await searchParams;
  const p = patientById(id);
  if (!p) notFound();

  const rows = statementFor(p.id);
  const bal = balanceFor(p.id);
  const invoices = invoicesForPatient(p.id);

  return (
    <>
      <PageHead
        eyebrow={`${branchById(p.branchId)?.name} · ${p.fileNumber}`}
        title={p.fullName}
        sub={`${p.sex} · ${p.age} years · ${p.phone} · came from ${p.referralSource}`}
        right={
          bal === 0 ? (
            <span className="pill paid">Settled</span>
          ) : bal > 0 ? (
            <span className="pill due">Owes {formatINR(bal, { paise: false })}</span>
          ) : (
            <span className="pill credit">In credit {formatINR(bal, { paise: false })}</span>
          )
        }
      />

      {welcome ? (
        <div className="welcome">
          <strong>Registered.</strong> File number {p.fileNumber} created at{' '}
          {branchById(p.branchId)?.name}. The ledger below is empty until the first procedure is
          billed — which is exactly what it should look like for a new patient.
        </div>
      ) : null}

      <Card title="Ledger" note="Running balance, derived from entries every time" flush>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Narration</th>
                <th className="num">Amount</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="mono">{r.occurredOn}</td>
                  <td className="strong">{TYPE_LABEL[r.entryType]}</td>
                  <td className="muted">
                    {r.invoiceId ? (
                      <a className="link mono" href={`/invoices/${r.invoiceId}`}>
                        {r.narration}
                      </a>
                    ) : (
                      <span className="mono">{r.narration}</span>
                    )}
                  </td>
                  <td className="num" style={{ color: r.amountPaise < 0 ? 'var(--ok)' : 'var(--ink)' }}>
                    {formatINR(r.amountPaise)}
                  </td>
                  <td className="num strong">{formatINR(r.runningBalancePaise)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Closing balance</td>
                <td className="num" style={{ color: bal > 0 ? 'var(--rust)' : 'var(--ok)' }}>
                  {formatINR(bal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card title="Invoices" flush>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Issued</th>
                <th>Doctor</th>
                <th className="num">Total</th>
                <th className="num">Due</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => {
                const due = subtract(i.computed.totalPaise, i.allocatedPaise);
                return (
                  <tr key={i.id}>
                    <td className="strong">
                      <a className="link mono" href={`/invoices/${i.id}`}>{i.number}</a>
                    </td>
                    <td className="mono">{i.issuedOn}</td>
                    <td>{i.doctor}</td>
                    <td className="num">{formatINR(i.computed.totalPaise)}</td>
                    <td className="num strong" style={{ color: due > 0 ? 'var(--rust)' : 'var(--ok)' }}>
                      {due === 0 ? 'Settled' : formatINR(due)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
