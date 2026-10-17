import Link from 'next/link';
import { requireContext } from '@/lib/auth';
import { businessDate, displayDate } from '@/domain/dates';
import { add, formatINR, type Paise } from '@/domain/money';
import { canDo, scopeBranchIds } from '@/services/context';
import { dashboard } from '@/services/reports';
import { Card, Empty, MODE_LABEL, PageHead, StatusPill, Tile } from '@/components/ui';

export default async function Dashboard() {
  const ctx = await requireContext();
  const today = businessDate();
  const rows = await dashboard(ctx, scopeBranchIds(ctx), today);
  const single = ctx.activeBranchId !== 'all' ? ctx.activeBranchId : null;
  const sum = (f: (r: (typeof rows)[number]) => Paise) => add(...rows.map(f));
  const billed = sum((r) => r.billedPaise);
  const collected = sum((r) => r.collectedPaise);
  const outstanding = sum((r) => r.outstandingPaise);
  const unbilled = sum((r) => r.unbilledPaise);
  const unbilledCount = rows.reduce((s, r) => s + r.unbilledCount, 0);
  const billCount = rows.reduce((s, r) => s + r.billCount, 0);
  const canBill = single ? canDo(ctx, 'invoice.issue', single) : false;

  return (
    <>
      <PageHead
        eyebrow={displayDate(today)}
        title="Today"
        right={
          canBill ? (
            <Link className="cta" href="/patients">
              New bill
            </Link>
          ) : null
        }
      />
      {rows.length === 0 ? (
        <Empty>You don’t have access to branch figures. Use search to find a patient.</Empty>
      ) : (
        <>
          <div className="tiles">
            <Tile k={formatINR(billed, { paise: false })} l="Billed today" foot={`${billCount} bill${billCount === 1 ? '' : 's'}`} />
            <Tile k={formatINR(collected, { paise: false })} l="Collected today" />
            <Tile
              k={formatINR(unbilled, { paise: false })}
              l="Done, not billed"
              foot={`${unbilledCount} procedure${unbilledCount === 1 ? '' : 's'}`}
              tone={unbilledCount > 0 ? 'alert' : undefined}
            />
            <Tile k={formatINR(outstanding, { paise: false })} l="Patients owe" />
          </div>

          <Card title={rows.length > 1 ? 'Branches today' : 'Today at this branch'} flush>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Branch</th>
                    <th scope="col">Day</th>
                    <th scope="col" className="num">Bills</th>
                    <th scope="col" className="num">Billed</th>
                    <th scope="col">Collected by mode</th>
                    <th scope="col" className="num">Collected</th>
                    <th scope="col" className="num">Old system bills</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.branchId}>
                      <td className="strong">{r.branchName}</td>
                      <td>
                        <StatusPill status={r.dayStatus} />
                      </td>
                      <td className="num">{r.billCount}</td>
                      <td className="num">{formatINR(r.billedPaise)}</td>
                      <td className="muted small">
                        {Object.entries(r.byMode).length === 0
                          ? '—'
                          : Object.entries(r.byMode)
                              .map(([m, v]) => `${MODE_LABEL[m] ?? m} ${formatINR(v as Paise, { paise: false })}`)
                              .join(' · ')}
                      </td>
                      <td className="num strong">{formatINR(r.collectedPaise)}</td>
                      <td className="num">
                        {r.legacyBillCount === null ? (
                          <span className="muted">at close</span>
                        ) : (
                          <span className={r.legacyBillCount === r.billCount ? 'variance-ok' : 'variance-bad'}>
                            {r.billCount} of {r.legacyBillCount}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="row">
            {unbilledCount > 0 ? (
              <Card title="Done but not billed" action={<Link className="link" href="/unbilled">Bill them →</Link>}>
                <p>
                  {unbilledCount} procedure{unbilledCount === 1 ? '' : 's'} worth <strong>{formatINR(unbilled)}</strong> recorded without a bill.
                </p>
              </Card>
            ) : null}
            <Card title="Patients owe" action={<Link className="link" href="/receivables">See who →</Link>}>
              <p>
                <strong>{formatINR(outstanding)}</strong> across open bills{rows.length > 1 ? ' at all branches' : ''}.
              </p>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
