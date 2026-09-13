import { PageHead, Card } from '@/components/ui';
import { formatINR, subtract } from '@/domain/money';
import { ageing, INVOICES, patientById, TODAY } from '@/lib/seed';

function daysOld(iso: string) {
  return Math.floor((Date.parse(TODAY) - Date.parse(iso)) / 86400000);
}

export default function ReceivablesPage() {
  const age = ageing();
  const open = INVOICES.filter((i) => subtract(i.computed.totalPaise, i.allocatedPaise) > 0).sort(
    (a, b) => a.issuedOn.localeCompare(b.issuedOn),
  );

  return (
    <>
      <PageHead
        title="Receivables"
        sub="The list nobody has, which is why nobody calls."
      />

      <div className="tiles">
        <div className="tile"><div className="k">{formatINR(age.current, { paise: false })}</div><div className="l">Current · 0–30 days</div></div>
        <div className="tile"><div className="k">{formatINR(age.days31to60, { paise: false })}</div><div className="l">31–60 days</div></div>
        <div className="tile"><div className="k">{formatINR(age.days61to90, { paise: false })}</div><div className="l">61–90 days</div></div>
        <div className="tile alert"><div className="k">{formatINR(age.over90, { paise: false })}</div><div className="l">Over 90 days</div><div className="foot">Collection probability drops below half here</div></div>
      </div>

      <Card title="Collections worklist" note="Oldest first" flush>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Patient</th>
                <th>Issued</th>
                <th className="num">Age</th>
                <th className="num">Total</th>
                <th className="num">Paid</th>
                <th className="num">Due</th>
              </tr>
            </thead>
            <tbody>
              {open.map((i) => {
                const due = subtract(i.computed.totalPaise, i.allocatedPaise);
                const d = daysOld(i.issuedOn);
                return (
                  <tr key={i.id}>
                    <td className="strong"><a className="link mono" href={`/invoices/${i.id}`}>{i.number}</a></td>
                    <td>{patientById(i.patientId)?.fullName}</td>
                    <td className="mono">{i.issuedOn}</td>
                    <td className="num" style={{ color: d > 90 ? 'var(--rust)' : 'var(--ink-2)' }}>{d} d</td>
                    <td className="num">{formatINR(i.computed.totalPaise)}</td>
                    <td className="num muted">{formatINR(i.allocatedPaise)}</td>
                    <td className="num strong" style={{ color: 'var(--rust)' }}>{formatINR(due)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><td colSpan={6}>Total outstanding</td><td className="num">{formatINR(age.total)}</td></tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </>
  );
}
