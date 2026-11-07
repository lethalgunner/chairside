import { notFound } from 'next/navigation';
import { requireContext } from '@/lib/auth';
import { displayDate } from '@/domain/dates';
import { formatINR, type Paise } from '@/domain/money';
import { amountInWords } from '@/domain/words';
import { getPrintHeader } from '@/services/branches';
import { getInvoice } from '@/services/invoices';
import { getPatient } from '@/services/patients';
import { testSeriesEnabled } from '@/services/util';
import PrintHead, { PrintBar } from '@/components/PrintHead';

/**
 * A printable bill (Sprint 5, LET-174), printed or saved as PDF by the
 * browser. Until a CA signs off GST and the real bill series starts, every
 * printout says it is a test and not a tax invoice. ⚖️
 */
export default async function PrintBillPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const { id } = await params;
  const inv = await getInvoice(ctx, id);
  if (!inv) notFound();
  const [head, patient] = await Promise.all([getPrintHeader(ctx, inv.branchId), getPatient(ctx, inv.patientId)]);
  const t = inv.totals;
  const test = testSeriesEnabled();
  return (
    <>
      <PrintBar title={`Bill ${inv.number}`} testNote={test ? 'Test series: not a tax invoice' : null} />
      <article className="print-doc">
        <PrintHead {...head} />
        {test ? <div className="test-mark">TEST BILL · NOT A TAX INVOICE</div> : null}
        {inv.status === 'void' ? <div className="test-mark">CANCELLED{inv.voidReason ? `: ${inv.voidReason}` : ''}</div> : null}
        <h1>Bill {inv.number}</h1>
        <div className="meta">
          <div>
            <strong>{inv.patientName}</strong>
            {patient?.fileNumbers.length ? <div>File {patient.fileNumbers.join(', ')}</div> : null}
          </div>
          <div>
            <div>Date {displayDate(inv.issuedOn)}</div>
            {inv.doctorName ? <div>Doctor {inv.doctorName}</div> : null}
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>HSN/SAC</th>
              <th className="num">Qty</th>
              <th className="num">Rate</th>
              <th className="num">Discount</th>
              <th className="num">GST</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.description}</td>
                <td>{l.hsnSacCode}</td>
                <td className="num">{l.quantity}</td>
                <td className="num">{formatINR(l.unitPricePaise as Paise)}</td>
                <td className="num">{l.discountPaise ? formatINR(l.discountPaise as Paise) : '—'}</td>
                <td className="num">{l.gstRateBp ? `${l.gstRateBp / 100}%` : 'Exempt'}</td>
                <td className="num">{formatINR(l.lineTotalPaise as Paise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="totals">
          {t.exemptPaise ? <div><span>Treatment (exempt)</span><span>{formatINR(t.exemptPaise)}</span></div> : null}
          {t.taxablePaise ? <div><span>Taxable value</span><span>{formatINR(t.taxablePaise)}</span></div> : null}
          {t.cgstPaise ? <div><span>CGST</span><span>{formatINR(t.cgstPaise)}</span></div> : null}
          {t.sgstPaise ? <div><span>SGST</span><span>{formatINR(t.sgstPaise)}</span></div> : null}
          {t.igstPaise ? <div><span>IGST</span><span>{formatINR(t.igstPaise)}</span></div> : null}
          {t.roundingPaise ? <div><span>Rounding</span><span>{formatINR(t.roundingPaise)}</span></div> : null}
          <div><strong>Total</strong><strong>{formatINR(t.totalPaise)}</strong></div>
          <div><span>Paid</span><span>{formatINR(inv.paidPaise)}</span></div>
          <div><strong>Due</strong><strong>{formatINR(inv.duePaise)}</strong></div>
        </div>
        <p className="small">{amountInWords(t.totalPaise)}</p>
        {head.footer ? <div className="print-foot">{head.footer}</div> : null}
      </article>
    </>
  );
}
