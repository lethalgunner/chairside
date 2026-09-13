import { PageHead, Card, Initials } from '@/components/ui';
import { formatINR } from '@/domain/money';
import { PATIENTS, balanceFor, branchById } from '@/lib/seed';

export default function PatientsPage() {
  return (
    <>
      <PageHead
        title="Patients"
        sub="One patient, one record — however many branches they visit."
      />
      <Card title={`${PATIENTS.length} patients`} note="Balance derived from ledger entries, never cached" flush>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Patient</th>
                <th>Phone</th>
                <th>Branch</th>
                <th>Came from</th>
                <th>Last visit</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {PATIENTS.map((p) => {
                const bal = balanceFor(p.id);
                return (
                  <tr key={p.id}>
                    <td className="strong">
                      <a href={`/patients/${p.id}`} className="patient-cell">
                        <Initials name={p.fullName} />
                        <span>
                          <span className="link">{p.fullName}</span>
                          <br />
                          <span className="mono muted">
                            {p.fileNumber} · {p.sex} {p.age}
                          </span>
                        </span>
                      </a>
                    </td>
                    <td className="mono">{p.phone}</td>
                    <td>{branchById(p.branchId)?.name}</td>
                    <td className="muted">{p.referralSource}</td>
                    <td className="mono">{p.lastVisit}</td>
                    <td className="num strong" style={{ color: bal > 0 ? 'var(--rust)' : bal < 0 ? 'var(--amber)' : 'var(--ok)' }}>
                      {bal === 0 ? 'Settled' : formatINR(bal)}
                      {bal < 0 ? <><br /><span className="pill credit">In credit</span></> : null}
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
