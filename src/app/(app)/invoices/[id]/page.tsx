import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireContext } from '@/lib/auth';
import { displayDate } from '@/domain/dates';
import { add, formatINR, type Paise } from '@/domain/money';
import type { TaxCategory } from '@/domain/tax';
import { canDo } from '@/services/context';
import { getInvoice } from '@/services/invoices';
import { CategoryLabel, Card, MODE_LABEL, PageHead, StatusPill, TaxPill } from '@/components/ui';
import VoidForm from './VoidForm';

/** What GST calls this document, from what it contains (CGST Rules 46, 46A, 49). */
function documentTitle(gstRegistered: boolean, exempt: number, taxable: number): string {
  if (!gstRegistered) return 'Bill';
  if (taxable > 0 && exempt > 0) return 'Invoice-cum-bill of supply';
  if (taxable > 0) return 'Tax invoice';
  return 'Bill of supply';
}

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const { id } = await params;
  const inv = await getInvoice(ctx, id);
  if (!inv) notFound();
  const t = inv.totals;
  const tax = add(t.cgstPaise, t.sgstPaise, t.igstPaise);
  const sameBranch = ctx.activeBranchId === inv.branchId;
  const canPay = sameBranch && inv.status === 'issued' && inv.duePaise > 0 && canDo(ctx, 'receipt.record', inv.branchId);
  const canVoid = inv.status === 'issued' && inv.paidPaise === 0 && canDo(ctx, 'invoice.void', inv.branchId);

  return (
    <>
      <PageHead
        eyebrow={`${documentTitle(inv.gstRegistered, t.exemptPaise, t.taxablePaise)} · TEST SERIES, not for the patient · ${inv.branchName}`}
        title={inv.number}
        sub={`${displayDate(inv.issuedOn)} · ${inv.patientName}${inv.doctorName ? ` · ${inv.doctorName}` : ''}`}
        right={
          <>
            <StatusPill status={inv.status} />
            {canPay ? <Link className="cta" href={`/receipts/new?patient=${inv.patientId}`}>Record payment</Link> : null}
          </>
        }
      />
      {inv.status === 'void' ? <div className="callout warn">Cancelled: {inv.voidReason}. The number stays in the series so there is no gap.</div> : null}
      {inv.status === 'issued' && inv.duePaise > 0 && !sameBranch ? <div className="callout">Switch to {inv.branchName} in the sidebar to take a payment against this bill.</div> : null}
      <Card title="Lines" flush>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Description</th>
                <th scope="col">Tax</th>
                <th scope="col" className="num">Qty</th>
                <th scope="col" className="num">Rate</th>
                <th scope="col" className="num">Discount</th>
                <th scope="col" className="num">Taxable value</th>
                <th scope="col" className="num">CGST</th>
                <th scope="col" className="num">SGST</th>
                <th scope="col" className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l) => (
                <tr key={l.id}>
                  <td className="mono muted">{l.lineNumber}</td>
                  <td className="strong">
                    {l.description}
                    {l.discountReason ? <div className="muted small">Discount: {l.discountReason}</div> : null}
                  </td>
                  <td>
                    <TaxPill rateBp={l.gstRateBp} code={l.hsnSacCode} />
                    <br />
                    <CategoryLabel c={l.taxCategory as TaxCategory} />
                  </td>
                  <td className="num">{l.quantity}</td>
                  <td className="num">{formatINR(l.unitPricePaise as Paise)}</td>
                  <td className="num muted">{l.discountPaise ? `−${formatINR(l.discountPaise as Paise)}` : '—'}</td>
                  <td className="num">{formatINR(l.taxableValuePaise as Paise)}</td>
                  <td className="num muted">{l.cgstPaise ? formatINR(l.cgstPaise as Paise) : '—'}</td>
                  <td className="num muted">{l.sgstPaise ? formatINR(l.sgstPaise as Paise) : '—'}</td>
                  <td className="num strong">{formatINR(l.lineTotalPaise as Paise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="row">
        <Card title="Summary">
          <dl className="kv">
            <dt>Exempt treatment</dt>
            <dd>{formatINR(t.exemptPaise)}</dd>
            <dt>Taxable value</dt>
            <dd>{formatINR(t.taxablePaise)}</dd>
            <dt>CGST</dt>
            <dd>{formatINR(t.cgstPaise)}</dd>
            <dt>SGST</dt>
            <dd>{formatINR(t.sgstPaise)}</dd>
            {t.igstPaise ? (<><dt>IGST</dt><dd>{formatINR(t.igstPaise)}</dd></>) : null}
            <dt>Total GST</dt>
            <dd>{formatINR(tax)}</dd>
            {t.roundingPaise ? (<><dt>Rounding</dt><dd>{formatINR(t.roundingPaise)}</dd></>) : null}
            <dt className="strong">Total</dt>
            <dd className="strong">{formatINR(t.totalPaise)}</dd>
            <dt>Paid</dt>
            <dd>{formatINR(inv.paidPaise)}</dd>
            <dt className="strong">Due</dt>
            <dd className={`strong${inv.duePaise > 0 ? ' due-text' : ''}`}>{formatINR(inv.duePaise)}</dd>
          </dl>
          {inv.gstin ? <p className="muted small">GSTIN {inv.gstin}</p> : null}
        </Card>
        <Card title="Payments">
          {inv.payments.length === 0 ? (
            <p className="muted">No payments against this bill yet.</p>
          ) : (
            <ul className="plain">
              {inv.payments.map((p) => (
                <li key={p.receiptId}>
                  <span className="mono">{p.number}</span> · {displayDate(p.receivedOn)} · {MODE_LABEL[p.mode] ?? p.mode} · <strong>{formatINR(p.amountPaise)}</strong>
                </li>
              ))}
            </ul>
          )}
          <p><Link className="link" href={`/patients/${inv.patientId}`}>Patient account →</Link></p>
        </Card>
      </div>
      {canVoid ? <VoidForm invoiceId={inv.id} number={inv.number} /> : null}
    </>
  );
}
