import { Fragment } from 'react';
import { requireContext } from '@/lib/auth';
import { businessDate, displayDate, resolveViewDate, shortDay } from '@/domain/dates';
import { DENOMINATIONS } from '@/domain/ledger';
import { formatINR, type Paise } from '@/domain/money';
import { canDo } from '@/services/context';
import { getDaySummary } from '@/services/daybook';
import { Card, MODE_LABEL, PageHead, StatusPill } from '@/components/ui';
import DayCloseForm from './DayCloseForm';
import LegacyCompare from '@/components/LegacyCompare';
import { compareWithLegacy } from '@/domain/parallel';
import ReopenForm from './ReopenForm';
import DayNav from '@/components/DayNav';

export default async function DayClosePage({ searchParams }: { searchParams: Promise<{ date?: string | string[] }> }) {
  const ctx = await requireContext();
  if (ctx.activeBranchId === 'all') {
    return (
      <>
        <PageHead title="Day close" />
        <div className="callout warn">Each branch closes its own day. Pick a branch in the sidebar.</div>
      </>
    );
  }
  const branchId = ctx.activeBranchId;
  if (!canDo(ctx, 'day.close', branchId)) {
    return (
      <>
        <PageHead title="Day close" />
        <div className="callout">Closing the day is done by the front desk or branch manager.</div>
      </>
    );
  }
  const today = businessDate();
  // A past day only shows what happened (Q19, T27): no close, cash out or reopen.
  // Every write below stays tied to today on the server whatever the URL says.
  const { date, isToday } = resolveViewDate((await searchParams).date, today);
  const s = await getDaySummary(ctx, branchId, date);
  const canReopen = isToday && canDo(ctx, 'day.reopen', branchId);
  const comparison = s.closed
    ? compareWithLegacy({ legacyBillCount: s.closed.legacyBillCount, legacyCollectedPaise: s.closed.legacyCollectedPaise, billCount: s.billCount, collectedPaise: s.totalCollectedPaise })
    : null;

  return (
    <>
      <PageHead eyebrow={`${s.branchName} · ${displayDate(date)}`} title="Day close" right={<StatusPill status={s.status} />} />
      <DayNav date={date} today={today} isToday={isToday} href={(d) => (d ? `/day-close?date=${d}` : '/day-close')} />
      {s.status === 'reopened' ? (
        <div className="callout warn">
          Reopened by the owner: {s.reopenReason}. {isToday ? 'Close it again when done.' : 'It was not closed again.'}
        </div>
      ) : null}
      <div className="row">
        <Card title={isToday ? 'Collected today' : `Collected on ${shortDay(date)}`}>
          <dl className="kv">
            {Object.entries(s.byMode)
              .filter(([, v]) => v !== 0)
              .map(([m, v]) => (
                <Fragment key={m}>
                  <dt>{MODE_LABEL[m] ?? m}</dt>
                  <dd>{formatINR(v as Paise)}</dd>
                </Fragment>
              ))}
            <dt className="strong">Total collected</dt>
            <dd className="strong">{formatINR(s.totalCollectedPaise)}</dd>
            <dt>Bills issued</dt>
            <dd>{s.billCount} · {formatINR(s.billedPaise)}</dd>
          </dl>
        </Card>
        <Card title="Cash drawer">
          <dl className="kv">
            <dt>Opening float</dt>
            <dd>{formatINR(s.openingFloatPaise)}</dd>
            <dt>Cash received</dt>
            <dd>{formatINR(s.byMode.cash)}</dd>
            <dt>Cash paid out</dt>
            <dd>{s.cashOutPaise ? `−${formatINR(s.cashOutPaise)}` : '—'}</dd>
            <dt className="strong">Should be in the drawer</dt>
            <dd className="strong">{formatINR(s.expectedCashPaise)}</dd>
          </dl>
          {s.cashOutEntries.length ? (
            <ul className="plain small">
              {s.cashOutEntries.map((c) => (
                <li key={c.id}>{c.description}: {formatINR(c.amountPaise)}</li>
              ))}
            </ul>
          ) : null}
        </Card>
      </div>
      {s.status === 'closed' && s.closed ? (
        <Card title="Closed">
          <dl className="kv">
            <dt>Counted</dt>
            <dd>{formatINR(s.closed.countedCashPaise)}</dd>
            <dt>Difference</dt>
            <dd className={s.closed.variancePaise === 0 ? 'variance-ok' : 'variance-bad'}>{formatINR(s.closed.variancePaise)}</dd>
            {s.closed.varianceReason ? (<><dt>Reason</dt><dd>{s.closed.varianceReason}</dd></>) : null}
          </dl>
          {comparison ? <LegacyCompare c={comparison} /> : <p className="muted small">No old-system figures were entered at close.</p>}
          {!isToday ? null : canReopen ? <ReopenForm branchId={branchId} date={today} /> : <p className="muted small">Only the owner can reopen a closed day.</p>}
        </Card>
      ) : !isToday ? (
        <Card title="Not closed">
          <p>
            <strong>This day was not closed.</strong> The figures above are everything recorded on {shortDay(date)}: {s.billCount} bill{s.billCount === 1 ? '' : 's'} worth {formatINR(s.billedPaise)}, {formatINR(s.totalCollectedPaise)} collected.
          </p>
        </Card>
      ) : (
        <DayCloseForm
          denominations={[...DENOMINATIONS]}
          expectedCashPaise={s.expectedCashPaise}
          tolerancePaise={s.tolerancePaise}
          billCount={s.billCount}
          collectedPaise={s.totalCollectedPaise}
          canCashOut={canDo(ctx, 'expense.record_cash', branchId)}
        />
      )}
    </>
  );
}
