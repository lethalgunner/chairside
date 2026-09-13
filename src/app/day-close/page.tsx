import { PageHead, Card } from '@/components/ui';
import { formatINR } from '@/domain/money';
import { DENOMINATIONS } from '@/domain/ledger';
import {
  BRANCH,
  TODAY,
  dayClose,
  todaysReceipts,
  DRAWER_COUNT,
  OPENING_FLOAT,
  CASH_EXPENSES,
  patientById,
} from '@/lib/seed';

const MODE_LABEL: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
  financing: 'Financing',
};

export default function DayClosePage() {
  const day = dayClose();
  const receipts = todaysReceipts();
  const reconciles = day.variancePaise === 0;

  return (
    <>
      <PageHead
        eyebrow={`${BRANCH.name} · ${TODAY}`}
        title="Close the day"
        sub="Most practices have never had a day that simply closes."
        right={
          reconciles ? (
            <span className="pill paid">Reconciles</span>
          ) : (
            <span className="pill due">Needs explanation</span>
          )
        }
      />

      <div className="row">
        <Card title="What should be in the drawer">
          <dl className="kv">
            <dt>Opening float</dt>
            <dd>{formatINR(OPENING_FLOAT)}</dd>
            <dt>Cash received today</dt>
            <dd>{formatINR(day.byMode.cash)}</dd>
            <dt>Cash paid out</dt>
            <dd>−{formatINR(CASH_EXPENSES)}</dd>
            <dt className="strong">Expected</dt>
            <dd className="strong">{formatINR(day.expectedCashPaise)}</dd>
            <dt>Counted</dt>
            <dd>{formatINR(day.countedCashPaise)}</dd>
            <dt className="strong">Variance</dt>
            <dd className={reconciles ? 'variance-ok' : 'variance-bad'}>
              {formatINR(day.variancePaise)}
            </dd>
          </dl>

          <div className={reconciles ? 'callout' : 'callout warn'}>
            {reconciles ? (
              <>
                <strong>Reconciles exactly.</strong> The day can be locked. Once locked it is
                immutable, and only the owner can reopen it — with the reopening itself recorded.
              </>
            ) : (
              <>
                <strong>Off by {formatINR(day.variancePaise)}.</strong> Above the ₹100 tolerance,
                so someone has to name the reason before this day locks. That requirement is the
                entire point of the screen — the arithmetic is the easy part.
              </>
            )}
          </div>
        </Card>

        <Card title="Physical count" note="Denomination breakdown">
          <div className="denoms">
            {DENOMINATIONS.map((d) => {
              const n = (DRAWER_COUNT as Record<string, number>)[String(d)] ?? 0;
              return (
                <div className="denom" key={d}>
                  <div className="d">₹{d} notes</div>
                  <div className="c">{n === 0 ? '—' : `× ${n}`}</div>
                </div>
              );
            })}
          </div>
          <dl className="kv" style={{ marginTop: 14 }}>
            <dt className="strong">Counted total</dt>
            <dd className="strong">{formatINR(day.countedCashPaise)}</dd>
          </dl>
        </Card>
      </div>

      <Card title="Collections by mode" note="Everything taken at this branch today" flush>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Mode</th>
                <th className="num">Amount</th>
                <th>Reconciles against</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(day.byMode) as (keyof typeof day.byMode)[])
                .filter((m) => day.byMode[m] !== 0)
                .map((m) => (
                  <tr key={m}>
                    <td className="strong">{MODE_LABEL[m]}</td>
                    <td className="num strong">{formatINR(day.byMode[m])}</td>
                    <td className="muted">
                      {m === 'cash'
                        ? 'The physical count above'
                        : m === 'upi'
                          ? 'UPI settlement statement, T+1'
                          : m === 'card'
                            ? 'Terminal batch settlement, net of MDR'
                            : 'Bank statement'}
                    </td>
                  </tr>
                ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total collected</td>
                <td className="num">{formatINR(day.totalCollectedPaise)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card title="Receipts today" flush>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Patient</th>
                <th>Mode</th>
                <th>Reference</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id}>
                  <td className="mono strong">{r.number}</td>
                  <td>{patientById(r.patientId)?.fullName}</td>
                  <td>{MODE_LABEL[r.mode]}</td>
                  <td className="mono muted">{r.reference ?? '—'}</td>
                  <td className="num strong">{formatINR(r.amountPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
