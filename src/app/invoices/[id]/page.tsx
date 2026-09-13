import { notFound } from 'next/navigation';
import { PageHead, Card, TaxPill, CategoryLabel } from '@/components/ui';
import { formatINR, subtract, add } from '@/domain/money';
import { invoiceById, patientById, branchById, INVOICES } from '@/lib/seed';

export function generateStaticParams() {
  return INVOICES.map((i) => ({ id: i.id }));
}

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inv = invoiceById(id);
  if (!inv) notFound();

  const patient = patientById(inv.patientId);
  const branch = branchById(inv.branchId)!;
  const c = inv.computed;
  const due = subtract(c.totalPaise, inv.allocatedPaise);
  const totalTax = add(c.cgstPaise, c.sgstPaise, c.igstPaise);

  return (
    <>
      <PageHead
        eyebrow={`${branch.name} · ${inv.doctor}`}
        title={inv.number}
        sub={`Issued ${inv.issuedOn} · ${patient?.fullName} (${patient?.fileNumber})`}
        right={
          due > 0 ? (
            <span className="pill due">Due {formatINR(due, { paise: false })}</span>
          ) : (
            <span className="pill paid">Settled</span>
          )
        }
      />

      {!branch.gstRegistered ? (
        <div className="callout warn">
          <strong>{branch.name} is not GST-registered.</strong> Because dental treatment is an exempt
          healthcare service, a branch whose taxable turnover sits under the threshold need not
          register — so nothing on this invoice carries tax, whatever the catalogue says. That is a
          real price advantage, and it disappears the moment taxable turnover crosses the threshold.
        </div>
      ) : null}

      <Card
        title="Lines"
        note="Tax is a property of the line, never the document"
        flush
      >
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 30 }}>#</th>
                <th>Description</th>
                <th>Classification</th>
                <th className="num">Qty</th>
                <th className="num">Rate</th>
                <th className="num">Discount</th>
                <th className="num">Taxable value</th>
                <th className="num">CGST</th>
                <th className="num">SGST</th>
                <th className="num">Line total</th>
              </tr>
            </thead>
            <tbody>
              {c.lines.map((l) => (
                <tr key={l.lineNumber}>
                  <td className="mono muted">{l.lineNumber}</td>
                  <td className="strong">
                    {l.description}
                    {l.discountReason ? (
                      <>
                        <br />
                        <span className="muted" style={{ fontSize: 11 }}>
                          {l.discountReason}
                        </span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <TaxPill rateBp={l.gstRateBp} code={l.hsnSacCode} />
                    <br />
                    <CategoryLabel c={l.taxCategory} />
                  </td>
                  <td className="num">{l.quantity}</td>
                  <td className="num">{formatINR(l.unitPricePaise)}</td>
                  <td className="num muted">
                    {l.discountPaise === 0 ? '—' : `−${formatINR(l.discountPaise)}`}
                  </td>
                  <td className="num">{formatINR(l.taxableValuePaise)}</td>
                  <td className="num muted">
                    {l.cgstPaise === 0 ? '—' : formatINR(l.cgstPaise)}
                  </td>
                  <td className="num muted">
                    {l.sgstPaise === 0 ? '—' : formatINR(l.sgstPaise)}
                  </td>
                  <td className="num strong">{formatINR(l.lineTotalPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="row">
        <Card title="Summary">
          <dl className="kv">
            <dt>Subtotal (gross of discount)</dt>
            <dd>{formatINR(c.subtotalPaise)}</dd>
            <dt>Less discount</dt>
            <dd>{c.discountPaise === 0 ? '—' : `−${formatINR(c.discountPaise)}`}</dd>
            <dt>Exempt value</dt>
            <dd>{formatINR(c.exemptPaise)}</dd>
            <dt>Taxable value</dt>
            <dd>{formatINR(c.taxablePaise)}</dd>
            <dt>CGST</dt>
            <dd>{formatINR(c.cgstPaise)}</dd>
            <dt>SGST</dt>
            <dd>{formatINR(c.sgstPaise)}</dd>
            {c.igstPaise !== 0 ? (
              <>
                <dt>IGST</dt>
                <dd>{formatINR(c.igstPaise)}</dd>
              </>
            ) : null}
            <dt>Rounding</dt>
            <dd>{c.roundingPaise === 0 ? '—' : formatINR(c.roundingPaise)}</dd>
            <dt className="strong">Payable</dt>
            <dd className="strong">{formatINR(c.totalPaise)}</dd>
            <dt>Received</dt>
            <dd>{formatINR(inv.allocatedPaise)}</dd>
            <dt className="strong">Balance due</dt>
            <dd className="strong" style={{ color: due > 0 ? 'var(--rust)' : 'var(--ok)' }}>
              {formatINR(due)}
            </dd>
          </dl>
        </Card>

        <Card title="Why this invoice looks like this" note="The thing incumbents get wrong">
          <p style={{ marginTop: 0, fontSize: 13, color: 'var(--ink-2)' }}>
            The healthcare exemption attaches to the <strong>service</strong>, not to the goods. So
            this single document carries{' '}
            {c.lines.filter((l) => l.isExempt).length > 0 ? (
              <>
                {c.lines.filter((l) => l.isExempt).length} exempt line
                {c.lines.filter((l) => l.isExempt).length > 1 ? 's' : ''}
              </>
            ) : (
              'no exempt lines'
            )}{' '}
            alongside {c.lines.filter((l) => !l.isExempt).length} taxable one
            {c.lines.filter((l) => !l.isExempt).length === 1 ? '' : 's'}, each printing its own code,
            rate and amount.
          </p>
          <p style={{ fontSize: 13, color: 'var(--ink-2)' }}>
            Most clinic software treats tax as a single setting on the whole invoice, which is simply
            wrong for dentistry — and it is the thing that makes the practice&apos;s accountant
            re-code every line by hand.
          </p>
          <div className="callout">
            Total tax on this invoice is <strong>{formatINR(totalTax)}</strong>. CGST and SGST are
            derived by splitting that figure in two, never computed independently at half-rate each —
            double rounding drifts a paisa, and a paisa is what an auditor circles.
          </div>
          <p className="muted" style={{ fontSize: 11.5, marginBottom: 0 }}>
            Tax treatment encoded from public sources and pending confirmation by a practising CA.
            Not legal advice.
          </p>
        </Card>
      </div>
    </>
  );
}
