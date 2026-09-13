import { PageHead, Card } from '@/components/ui';
import { formatINR, subtract, add } from '@/domain/money';
import { INVOICES, patientById, branchById } from '@/lib/seed';

export default function InvoicesPage() {
  return (
    <>
      <PageHead title="Invoices" sub="Numbered per branch, per financial year, gaplessly." />
      <Card title={`${INVOICES.length} invoices`} flush>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Patient</th>
                <th>Branch</th>
                <th>Issued</th>
                <th className="num">Exempt</th>
                <th className="num">Taxable</th>
                <th className="num">Tax</th>
                <th className="num">Total</th>
                <th className="num">Due</th>
              </tr>
            </thead>
            <tbody>
              {INVOICES.map((i) => {
                const c = i.computed;
                const due = subtract(c.totalPaise, i.allocatedPaise);
                const tax = add(c.cgstPaise, c.sgstPaise, c.igstPaise);
                return (
                  <tr key={i.id}>
                    <td className="strong">
                      <a className="link mono" href={`/invoices/${i.id}`}>{i.number}</a>
                    </td>
                    <td>{patientById(i.patientId)?.fullName}</td>
                    <td className="muted">{branchById(i.branchId)?.name}</td>
                    <td className="mono">{i.issuedOn}</td>
                    <td className="num muted">{formatINR(c.exemptPaise)}</td>
                    <td className="num muted">{c.taxablePaise === 0 ? '—' : formatINR(c.taxablePaise)}</td>
                    <td className="num muted">{tax === 0 ? '—' : formatINR(tax)}</td>
                    <td className="num strong">{formatINR(c.totalPaise)}</td>
                    <td className="num" style={{ color: due > 0 ? 'var(--rust)' : 'var(--ok)' }}>
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
