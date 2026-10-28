import Link from 'next/link';
import { requireContext } from '@/lib/auth';
import { businessDate, displayDate, resolveViewDate, shortDay } from '@/domain/dates';
import { add, formatINR, type Paise } from '@/domain/money';
import { canDo, scopeBranchIds } from '@/services/context';
import { dashboard, parallelRun, unclosedEarlierDays } from '@/services/reports';
import { closeStreaks, STREAK_WINDOW_DAYS } from '@/services/streak';
import { recordDashboardView } from '@/services/usage';
import { Card, Empty, MODE_LABEL, PageHead, StatusPill, Tile } from '@/components/ui';
import DayNav from '@/components/DayNav';

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ date?: string | string[] }> }) {
  const ctx = await requireContext();
  await recordDashboardView(ctx); // T26 pilot usage log: one per person per day, never throws
  const today = businessDate();
  // A past day is a read-only view (Q19, T27): nothing on it creates or closes anything.
  const { date, isToday } = resolveViewDate((await searchParams).date, today);
  const [rows, pilot, unclosed, streaks] = await Promise.all([
    dashboard(ctx, scopeBranchIds(ctx), date),
    parallelRun(ctx, scopeBranchIds(ctx), date),
    isToday ? unclosedEarlierDays(ctx, ctx.branchIds, today) : Promise.resolve([]),
    isToday ? closeStreaks(ctx, scopeBranchIds(ctx), today) : Promise.resolve(new Map<string, number>()),
  ]);
  const inScope = new Set(scopeBranchIds(ctx));
  const dayWord = isToday ? 'today' : `on ${shortDay(date)}`;
  const single = ctx.activeBranchId !== 'all' ? ctx.activeBranchId : null;
  const sum = (f: (r: (typeof rows)[number]) => Paise) => add(...rows.map(f));
  const billed = sum((r) => r.billedPaise);
  const collected = sum((r) => r.collectedPaise);
  const outstanding = sum((r) => r.outstandingPaise);
  const unbilled = sum((r) => r.unbilledPaise);
  const unbilledCount = rows.reduce((s, r) => s + r.unbilledCount, 0);
  const billCount = rows.reduce((s, r) => s + r.billCount, 0);
  const canBill = isToday && single ? canDo(ctx, 'invoice.issue', single) : false;

  return (
    <>
      <PageHead
        eyebrow={displayDate(date)}
        title={isToday ? 'Today' : shortDay(date)}
        right={
          canBill ? (
            <Link className="cta" href="/patients">
              Find patient to bill
            </Link>
          ) : null
        }
      />
      <DayNav date={date} today={today} isToday={isToday} href={(d) => (d ? `/?date=${d}` : '/')} />
      {unclosed.map((u) => (
        <div key={u.branchId} className="callout warn" role="status">
          <strong>{u.branchName}</strong>: {shortDay(u.date)} was not closed.{' '}
          <Link className="link" href={`/?date=${u.date}`}>View {shortDay(u.date)}</Link>
          {inScope.has(u.branchId) ? null : <span className="muted"> (pick {u.branchName} or All branches in the branch menu to see it)</span>}
        </div>
      ))}
      {rows.length === 0 ? (
        <Empty>You don’t have access to branch figures. Use search to find a patient.</Empty>
      ) : (
        <>
          <div className="tiles">
            <Tile k={formatINR(billed, { paise: false })} l={`Billed ${dayWord}`} foot={`${billCount} bill${billCount === 1 ? '' : 's'}`} />
            <Tile k={formatINR(collected, { paise: false })} l={`Collected ${dayWord}`} />
            {isToday ? (
              <>
                <Tile
                  k={formatINR(unbilled, { paise: false })}
                  l="Done, not billed"
                  foot={`${unbilledCount} procedure${unbilledCount === 1 ? '' : 's'}`}
                  tone={unbilledCount > 0 ? 'alert' : undefined}
                />
                <Tile k={formatINR(outstanding, { paise: false })} l="Patients owe" />
              </>
            ) : null}
          </div>

          <Card title={isToday ? (rows.length > 1 ? 'Branches today' : 'Today at this branch') : rows.length > 1 ? `Branches on ${shortDay(date)}` : `This branch on ${shortDay(date)}`} flush>
            <div className="tablewrap">
              <table className="stack-table">
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
                      <td data-label="Branch" className="strong">{r.branchName}</td>
                      <td data-label="Day">
                        <StatusPill status={r.dayStatus} />
                        {(streaks.get(r.branchId) ?? 0) >= 2 ? (
                          <span className="streak">
                            Closed {(streaks.get(r.branchId) ?? 0) > STREAK_WINDOW_DAYS ? `${STREAK_WINDOW_DAYS}+` : streaks.get(r.branchId)} days in a row
                          </span>
                        ) : null}
                      </td>
                      <td data-label="Bills" className="num">{r.billCount}</td>
                      <td data-label="Billed" className="num">{formatINR(r.billedPaise)}</td>
                      <td data-label="Collected by mode" className="muted small">
                        {Object.entries(r.byMode).length === 0
                          ? '—'
                          : Object.entries(r.byMode)
                              .map(([m, v]) => `${MODE_LABEL[m] ?? m} ${formatINR(v as Paise, { paise: false })}`)
                              .join(' · ')}
                      </td>
                      <td data-label="Collected" className="num strong">{formatINR(r.collectedPaise)}</td>
                      <td data-label="Old system bills" className="num">
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

          {pilot.length > 0 ? (
            <Card title="Parallel run" note={`${isToday ? 'Last 7 days' : `7 days to ${shortDay(date)}`} · old system vs Chairside`} flush>
              <div className="tablewrap">
                <table className="stack-table">
                  <thead>
                    <tr>
                      <th scope="col">Day</th>
                      <th scope="col">Branch</th>
                      <th scope="col">Closed?</th>
                      <th scope="col" className="num">Bills old / new</th>
                      <th scope="col" className="num">Collected old / new</th>
                      <th scope="col">Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pilot.map((p) => {
                      const c = p.comparison;
                      return (
                        <tr key={`${p.date}-${p.branchId}`} className={c && !c.matches ? 'diff-row' : undefined}>
                          <td data-label="Day">{displayDate(p.date)}</td>
                          <td data-label="Branch" className="strong">{p.branchName}</td>
                          <td data-label="Closed?">{p.dayStatus === 'closed' ? 'Closed' : p.dayStatus === 'reopened' ? 'Reopened' : 'Not yet'}</td>
                          <td data-label="Bills old / new" className="num">{c?.bills.old ?? '—'} / {p.billCount}</td>
                          <td data-label="Collected old / new" className="num">{c?.collected.old != null ? formatINR(c.collected.old, { paise: false }) : '—'} / {formatINR(p.collectedPaise, { paise: false })}</td>
                          <td data-label="Difference" className={c ? (c.matches ? 'variance-ok' : 'variance-bad strong') : 'muted'}>{c ? c.verdict : 'Old figures not entered'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          {/* Unbilled work and money owed are figures for now, not for a past day. */}
          {isToday ? (
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
          ) : null}
        </>
      )}
    </>
  );
}
