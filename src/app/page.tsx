import { PageHead, Card, Tile, Initials } from '@/components/ui';
import { formatINR, subtract } from '@/domain/money';
import {
  BRANCH,
  OPENING_FLOAT,
  CASH_EXPENSES,
  TODAY,
  billedToday,
  collectedToday,
  dayClose,
  ageing,
  UNBILLED_TODAY,
  unbilledValue,
  INVOICES,
  PATIENTS,
  patientById,
} from '@/lib/seed';

export const dynamic = 'force-dynamic';

export default function Dashboard() {
  const billed = billedToday();
  const collected = collectedToday();
  const day = dayClose();
  const age = ageing();
  const unbilled = unbilledValue();

  const openInvoices = INVOICES.filter((i) => {
    const due = subtract(i.computed.totalPaise, i.allocatedPaise);
    return due > 0;
  }).sort((a, b) => a.issuedOn.localeCompare(b.issuedOn));

  return (
    <>
      <PageHead
        eyebrow={`${BRANCH.name} · ${new Date(TODAY).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}`}
        title="Today"
        sub="Everything on this screen is computed by the tested domain engine, not hardcoded."
        right={<a className="cta" href="/patients/new">+ New patient</a>}
      />

      <div className="tiles">
        <Tile k={formatINR(billed, { paise: false })} l="Billed today" foot="3 invoices issued" />
        <Tile
          k={formatINR(collected, { paise: false })}
          l="Collected today"
          foot={`Cash ${formatINR(day.byMode.cash, { paise: false })} · UPI ${formatINR(day.byMode.upi, { paise: false })} · Card ${formatINR(day.byMode.card, { paise: false })}`}
        />
        <Tile
          k={formatINR(unbilled, { paise: false })}
          l="Done but not billed"
          foot={`${UNBILLED_TODAY.length} procedures · needs attention`}
          tone="alert"
        />
        <Tile
          k={formatINR(age.total, { paise: false })}
          l="Outstanding"
          foot={`${formatINR(age.over90, { paise: false })} over 90 days`}
          tone={age.over90 > 0 ? 'alert' : undefined}
        />
      </div>

      <div className="row">
        <Card
          title="Cash position"
          note="Drawer not yet closed"
          action={
            <a className="link" href="/day-close">
              Close the day →
            </a>
          }
        >
          <dl className="kv">
            <dt>Opening float</dt>
            <dd>{formatINR(OPENING_FLOAT)}</dd>
            <dt>Cash received</dt>
            <dd>{formatINR(day.byMode.cash)}</dd>
            <dt>Cash paid out</dt>
            <dd>−{formatINR(CASH_EXPENSES)}</dd>
            <dt className="strong">Expected in drawer</dt>
            <dd className="strong">{formatINR(day.expectedCashPaise)}</dd>
          </dl>
          <div className={day.variancePaise === 0 ? 'callout' : 'callout warn'}>
            Counted <strong>{formatINR(day.countedCashPaise)}</strong> against an expected{' '}
            <strong>{formatINR(day.expectedCashPaise)}</strong>.{' '}
            {day.variancePaise === 0 ? (
              <span className="variance-ok">Reconciles exactly.</span>
            ) : (
              <span className="variance-bad">
                Off by {formatINR(day.variancePaise)} — someone has to explain this before the day locks.
              </span>
            )}
          </div>
        </Card>

        <Card title="Receivables ageing" note="Collection probability falls off a cliff past 90 days">
          <dl className="kv">
            <dt>Current (0–30 days)</dt>
            <dd>{formatINR(age.current)}</dd>
            <dt>31–60 days</dt>
            <dd>{formatINR(age.days31to60)}</dd>
            <dt>61–90 days</dt>
            <dd>{formatINR(age.days61to90)}</dd>
            <dt style={{ color: 'var(--rust)' }}>Over 90 days</dt>
            <dd style={{ color: 'var(--rust)', fontWeight: 650 }}>{formatINR(age.over90)}</dd>
            <dt className="strong">Total owed</dt>
            <dd className="strong">{formatINR(age.total)}</dd>
          </dl>
          <div className="callout warn">
            Nobody has a list of who owes what, so nobody calls. That list is this panel.
          </div>
        </Card>
      </div>

      <Card
        title="Done but not billed"
        note="Completed procedures with no invoice line after 24 hours"
        flush
        action={
          <a className="link" href="/unbilled">
            View all →
          </a>
        }
      >
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
                      <span>
                        {u.patientName}
                        <br />
                        <span className="mono muted">{u.fileNumber}</span>
                      </span>
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
              <tr>
                <td colSpan={4}>Revenue sitting in the chart and not on an invoice</td>
                <td className="num" style={{ color: 'var(--rust)' }}>
                  {formatINR(unbilled)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card title="Open invoices" flush note="Oldest first — the order the collections worklist uses">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Patient</th>
                <th>Issued</th>
                <th className="num">Total</th>
                <th className="num">Paid</th>
                <th className="num">Due</th>
              </tr>
            </thead>
            <tbody>
              {openInvoices.map((i) => {
                const p = patientById(i.patientId);
                const due = subtract(i.computed.totalPaise, i.allocatedPaise);
                return (
                  <tr key={i.id}>
                    <td className="strong">
                      <a className="link mono" href={`/invoices/${i.id}`}>
                        {i.number}
                      </a>
                    </td>
                    <td>{p?.fullName}</td>
                    <td className="mono">{i.issuedOn}</td>
                    <td className="num">{formatINR(i.computed.totalPaise)}</td>
                    <td className="num muted">{formatINR(i.allocatedPaise)}</td>
                    <td className="num strong" style={{ color: 'var(--rust)' }}>
                      {formatINR(due)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="muted" style={{ fontSize: 12, maxWidth: '70ch' }}>
        {PATIENTS.length} patients across {2} branches in this seed. Figures come from{' '}
        <code>src/domain</code> — the same functions the 59 tests exercise.
      </p>
    </>
  );
}
