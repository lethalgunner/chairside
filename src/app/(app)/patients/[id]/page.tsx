import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireContext } from '@/lib/auth';
import { displayDate } from '@/domain/dates';
import { formatINR, type Paise } from '@/domain/money';
import { formatIndianMobile } from '@/domain/phone';
import { canDo } from '@/services/context';
import { listInvoices } from '@/services/invoices';
import { getPatient } from '@/services/patients';
import { patientAccount, patientReceipts } from '@/services/reports';
import { Card, Empty, MODE_LABEL, PageHead, StatusPill } from '@/components/ui';

const ENTRY_LABEL: Record<string, string> = {
  invoice: 'Bill',
  receipt: 'Payment',
  advance: 'Advance',
  advance_drawdown: 'Advance used',
  credit_note: 'Cancelled bill',
  refund: 'Refund',
  write_off: 'Written off',
  receipt_cancel: 'Cancelled payment',
};

export default async function PatientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  const ctx = await requireContext();
  const { id } = await params;
  const { new: isNew } = await searchParams;
  const patient = await getPatient(ctx, id);
  if (!patient) notFound();
  const [account, bills, payments] = await Promise.all([patientAccount(ctx, id), listInvoices(ctx, { branchIds: ctx.branchIds, patientId: id, limit: 50 }), patientReceipts(ctx, id)]);
  const branch = ctx.activeBranchId === 'all' ? null : ctx.activeBranchId;
  const canBill = branch ? canDo(ctx, 'invoice.issue', branch) : false;
  const canPay = branch ? canDo(ctx, 'receipt.record', branch) : false;
  const bal = account.balancePaise;

  return (
    <>
      {isNew ? (
        <div className="callout good" role="status">
          Registered. {canBill ? 'Next: add what was done today.' : ''}
        </div>
      ) : null}
      <PageHead
        eyebrow={patient.fileNumbers.join(' · ') || 'No file number yet'}
        title={patient.fullName}
        sub={[patient.age !== null ? `${patient.age} yrs` : null, patient.sex === 'F' ? 'Female' : patient.sex === 'M' ? 'Male' : patient.sex ? 'Other' : null, formatIndianMobile(patient.phone)].filter(Boolean).join(' · ')}
        right={
          <>
            {canBill ? (
              <Link className="cta" href={`/bills/new?patient=${patient.id}`}>
                New bill
              </Link>
            ) : null}
            {canPay ? (
              <Link className="cta secondary-cta" href={`/receipts/new?patient=${patient.id}`}>
                Record payment
              </Link>
            ) : null}
          </>
        }
      />
      {!branch ? <div className="callout">Pick a branch in the branch menu to bill this patient or take a payment.</div> : null}

      <div className="tiles two">
        <div className={`tile${bal > 0 ? ' alert' : bal < 0 ? ' good' : ''}`}>
          <div className="k">{formatINR(Math.abs(bal) as Paise)}</div>
          <div className="l">{bal > 0 ? 'Owes the clinic' : bal < 0 ? 'Paid in advance' : 'Nothing owed'}</div>
        </div>
      </div>

      <Card title="Bills" flush>
        {bills.length === 0 ? (
          <Empty action={canBill ? { href: `/bills/new?patient=${patient.id}`, label: 'Create the first bill' } : undefined}>No bills yet.</Empty>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Bill</th>
                  <th scope="col">Date</th>
                  <th scope="col">Branch</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">Total</th>
                  <th scope="col" className="num">Due</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link className="link mono" href={`/invoices/${b.id}`}>
                        {b.number}
                      </Link>
                    </td>
                    <td>{displayDate(b.issuedOn)}</td>
                    <td>{b.branchName}</td>
                    <td>
                      <StatusPill status={b.status} />
                    </td>
                    <td className="num">{formatINR(b.totalPaise)}</td>
                    <td className={`num${b.duePaise > 0 ? ' strong due-text' : ' muted'}`}>{b.duePaise > 0 ? formatINR(b.duePaise) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {payments.length > 0 ? (
        <Card title="Payments" flush>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Payment</th>
                  <th scope="col">Date</th>
                  <th scope="col">Branch</th>
                  <th scope="col">Paid by</th>
                  <th scope="col" className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className={p.cancelledAt ? 'muted' : undefined}>
                    <td>
                      <Link className="link mono" href={`/receipts/${p.id}`}>{p.cancelledAt ? <s>{p.number}</s> : p.number}</Link>
                      {p.cancelledAt ? <div className="small">Cancelled: {p.cancelReason}</div> : null}
                    </td>
                    <td>{displayDate(p.receivedOn)}</td>
                    <td>{p.branchName}</td>
                    <td>{MODE_LABEL[p.mode] ?? p.mode}</td>
                    <td className="num">{p.cancelledAt ? <s>{formatINR(p.amountPaise as Paise)}</s> : formatINR(p.amountPaise as Paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card title="Account statement" note="Every bill and payment, with the running balance" flush>
        {account.statement.length === 0 ? (
          <Empty>No entries yet.</Empty>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Entry</th>
                  <th scope="col">Detail</th>
                  <th scope="col" className="num">Amount</th>
                  <th scope="col" className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {account.statement.map((e, i) => (
                  <tr key={i}>
                    <td>{displayDate(e.occurredOn)}</td>
                    <td>{ENTRY_LABEL[e.entryType] ?? e.entryType}</td>
                    <td className="mono small">{e.narration}</td>
                    <td className="num">{e.amountPaise < 0 ? `−${formatINR(Math.abs(e.amountPaise) as Paise)}` : formatINR(e.amountPaise)}</td>
                    <td className="num strong">{formatINR(e.runningBalancePaise)}</td>
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
