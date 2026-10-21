import { Fragment } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireContext } from '@/lib/auth';
import { displayDate } from '@/domain/dates';
import { formatINR } from '@/domain/money';
import { canDo } from '@/services/context';
import { getReceipt } from '@/services/receipts';
import { Card, MODE_LABEL, PageHead } from '@/components/ui';
import CancelPaymentForm from './CancelPaymentForm';

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const { id } = await params;
  const r = await getReceipt(ctx, id);
  if (!r) notFound();
  const cancelled = !!r.cancelledAt;
  const canCancel = !cancelled && canDo(ctx, 'receipt.cancel', r.branchId);
  return (
    <>
      <PageHead
        eyebrow={`Payment · TEST SERIES · ${r.branchName}`}
        title={r.number}
        sub={`${displayDate(r.receivedOn)} · ${r.patientName}`}
        right={cancelled ? <span className="pill credit">Cancelled</span> : <span className="pill paid">Received</span>}
      />
      {cancelled ? <div className="callout warn">Cancelled: {r.cancelReason}. The number stays in the series; this amount is no longer counted anywhere.</div> : null}
      <Card title="Payment">
        <dl className="kv">
          <dt>Amount</dt>
          <dd className="strong">{cancelled ? <s>{formatINR(r.amountPaise)}</s> : formatINR(r.amountPaise)}</dd>
          <dt>Paid by</dt>
          <dd>{MODE_LABEL[r.mode] ?? r.mode}{r.reference ? ` · ${r.reference}` : ''}</dd>
          {r.allocations.map((a) => (
            <Fragment key={a.invoiceId}>
              <dt>Towards <Link className="link mono" href={`/invoices/${a.invoiceId}`}>{a.number}</Link></dt>
              <dd>{cancelled ? <s>{formatINR(a.amountPaise)}</s> : formatINR(a.amountPaise)}</dd>
            </Fragment>
          ))}
          {r.advancePaise > 0 ? (
            <>
              <dt>Kept as advance</dt>
              <dd>{formatINR(r.advancePaise)}</dd>
            </>
          ) : null}
        </dl>
        <p><Link className="link" href={`/patients/${r.patientId}`}>Patient account →</Link></p>
      </Card>
      {canCancel ? <CancelPaymentForm receiptId={r.id} number={r.number} /> : null}
      {!cancelled && !canCancel ? <p className="muted small">Only the owner can cancel a payment.</p> : null}
    </>
  );
}
