import { requireContext } from '@/lib/auth';
import { businessDate } from '@/domain/dates';
import { formatINR } from '@/domain/money';
import { scopeBranchIds } from '@/services/context';
import { gstPapers } from '@/services/reports';
import { Card, CategoryLabel, Empty, PageHead, TaxPill } from '@/components/ui';

export default async function GstPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await requireContext();
  const { month: m } = await searchParams;
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : businessDate().slice(0, 7);
  const papers = await gstPapers(ctx, scopeBranchIds(ctx), month);
  return (
    <>
      <PageHead title="GST working papers" sub="TEST, not for filing. Built from the tax stored on each bill line. A CA has not yet confirmed the treatment." />
      <form className="search-row" action="/gst">
        <label htmlFor="month">Month</label>
        <input id="month" name="month" type="month" defaultValue={month} />
        <button className="secondary-btn" type="submit">Show</button>
      </form>
      {papers.length === 0 ? <Empty>You don’t have access to GST papers.</Empty> : null}
      {papers.map((p) => (
        <Card key={p.branchId} title={`${p.branchName} · ${p.gstRegistered ? `GSTIN ${p.gstin}` : 'not GST-registered'}`} note={`${p.invoiceCount} bills`} flush>
          <div className="body">
            <dl className="kv">
              <dt>Exempt supplies</dt><dd>{formatINR(p.exemptPaise)}</dd>
              <dt>Taxable supplies</dt><dd>{formatINR(p.taxablePaise)}</dd>
              <dt>CGST</dt><dd>{formatINR(p.cgstPaise)}</dd>
              <dt>SGST</dt><dd>{formatINR(p.sgstPaise)}</dd>
              {p.igstPaise ? (<><dt>IGST</dt><dd>{formatINR(p.igstPaise)}</dd></>) : null}
            </dl>
          </div>
          {p.hsn.length ? (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">HSN/SAC</th>
                    <th scope="col">Type</th>
                    <th scope="col" className="num">Value</th>
                    <th scope="col" className="num">CGST</th>
                    <th scope="col" className="num">SGST</th>
                  </tr>
                </thead>
                <tbody>
                  {p.hsn.map((h) => (
                    <tr key={`${h.hsnSacCode}-${h.gstRateBp}-${h.taxCategory}`}>
                      <td><TaxPill rateBp={h.gstRateBp} code={h.hsnSacCode} /></td>
                      <td><CategoryLabel c={h.taxCategory} /></td>
                      <td className="num">{formatINR(h.valuePaise)}</td>
                      <td className="num">{formatINR(h.cgstPaise)}</td>
                      <td className="num">{formatINR(h.sgstPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
      ))}
    </>
  );
}
