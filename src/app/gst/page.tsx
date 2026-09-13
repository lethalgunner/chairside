import { PageHead, Card, TaxPill } from '@/components/ui';
import { formatINR, add } from '@/domain/money';
import { summariseByHsn, itcEligibleBp } from '@/domain/tax';
import { INVOICES, BRANCH } from '@/lib/seed';

export default function GstPage() {
  const registered = INVOICES.filter((i) => i.branchId === BRANCH.id).map((i) => i.computed);
  const rows = summariseByHsn(registered);
  const taxable = add(...registered.map((c) => c.taxablePaise));
  const exempt = add(...registered.map((c) => c.exemptPaise));
  const itc = itcEligibleBp(taxable, exempt);

  return (
    <>
      <PageHead
        eyebrow={`${BRANCH.name} · GSTIN ${BRANCH.gstin}`}
        title="GST working papers"
        sub="The split the accountant needs in order to file."
      />

      <Card title="Outward supplies by HSN / SAC" note="Grouped as the return expects" flush>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Classification</th>
                <th className="num">Rate</th>
                <th className="num">Value</th>
                <th className="num">CGST</th>
                <th className="num">SGST</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.hsnSacCode}-${r.gstRateBp}`}>
                  <td className="strong mono">{r.hsnSacCode}</td>
                  <td><TaxPill rateBp={r.gstRateBp} code={r.hsnSacCode} /></td>
                  <td className="num">{r.gstRateBp === 0 ? 'Exempt' : `${r.gstRateBp / 100}%`}</td>
                  <td className="num strong">{formatINR(r.valuePaise)}</td>
                  <td className="num muted">{r.cgstPaise === 0 ? '—' : formatINR(r.cgstPaise)}</td>
                  <td className="num muted">{r.sgstPaise === 0 ? '—' : formatINR(r.sgstPaise)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Totals</td>
                <td className="num">{formatINR(add(...rows.map((r) => r.valuePaise)))}</td>
                <td className="num">{formatINR(add(...rows.map((r) => r.cgstPaise)))}</td>
                <td className="num">{formatINR(add(...rows.map((r) => r.sgstPaise)))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <div className="row">
        <Card title="Exempt vs taxable">
          <dl className="kv">
            <dt>Exempt supplies (healthcare)</dt>
            <dd>{formatINR(exempt)}</dd>
            <dt>Taxable supplies (goods, cosmetic)</dt>
            <dd>{formatINR(taxable)}</dd>
            <dt className="strong">Total outward supply</dt>
            <dd className="strong">{formatINR(add(taxable, exempt))}</dd>
          </dl>
        </Card>

        <Card title="Input tax credit">
          <dl className="kv">
            <dt>Eligible proportion</dt>
            <dd className="strong">{(itc / 100).toFixed(1)}%</dd>
          </dl>
          <div className="callout">
            Where inputs serve both exempt and taxable supplies, credit is available only in the
            proportion taxable supplies bear to the total. A practice doing mostly exempt treatment
            recovers very little — which is worth showing the owner, because it changes how they
            think about pricing goods.
          </div>
          <p className="muted" style={{ fontSize: 11.5, marginBottom: 0 }}>
            Planning summary from public sources. Requires confirmation by a practising CA before
            any of it is relied on for filing. Not legal advice.
          </p>
        </Card>
      </div>
    </>
  );
}
