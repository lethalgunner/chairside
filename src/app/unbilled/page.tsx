import { PageHead, Card, Initials } from '@/components/ui';
import { formatINR } from '@/domain/money';
import { UNBILLED_TODAY, unbilledValue } from '@/lib/seed';

export default function UnbilledPage() {
  return (
    <>
      <PageHead
        title="Done but not billed"
        sub="Completed procedures with no invoice line against them."
        right={<span className="pill due">{formatINR(unbilledValue(), { paise: false })} at risk</span>}
      />

      <div className="callout warn">
        <strong>This is the control that pays for the subscription.</strong> A procedure added
        mid-appointment, noted on the chart, never carried to the invoice — it is the most common
        way a practice loses money, and it is invisible without a report like this one.
      </div>

      <Card title="Exceptions" note="Anything unbilled 24 hours after completion" flush>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Patient</th>
                <th>Procedure</th>
                <th>Doctor</th>
                <th>Completed</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {UNBILLED_TODAY.map((u) => (
                <tr key={u.id}>
                  <td className="strong">
                    <span className="patient-cell">
                      <Initials name={u.patientName} />
                      <span>{u.patientName}<br /><span className="mono muted">{u.fileNumber}</span></span>
                    </span>
                  </td>
                  <td>{u.procedure}</td>
                  <td>{u.doctor}</td>
                  <td className="mono">{u.completedAt}</td>
                  <td className="num strong">{formatINR(u.pricePaise)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={4}>Total unbilled</td><td className="num" style={{ color: 'var(--rust)' }}>{formatINR(unbilledValue())}</td></tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </>
  );
}
