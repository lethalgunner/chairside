import { Fragment } from 'react';
import { requireContext } from '@/lib/auth';
import { businessDate, displayDate } from '@/domain/dates';
import { DENOMINATIONS } from '@/domain/ledger';
import { formatINR, type Paise } from '@/domain/money';
import { canDo } from '@/services/context';
import { getDaySummary } from '@/services/daybook';
import { Card, MODE_LABEL, PageHead, StatusPill } from '@/components/ui';
import DayCloseForm from './DayCloseForm';
import ReopenForm from './ReopenForm';

export default async function DayClosePage() {
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
  const s = await getDaySummary(ctx, branchId, today);
  const canReopen = canDo(ctx, 'day.reopen', branchId);

  return (
    <>
      <PageHead eyebrow={`${s.branchName} · ${displayDate(today)}`} title="Day close" right={<StatusPill status={s.status} />} />
      {s.status === 'reopened' ? <div className="callout warn">Reopened by the owner: {s.reopenReason}. Close it again when done.</div> : null}
      <div className="row">
        <Card title="Collected today">
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
            {s.closed.legacyBillCount !== null ? (<><dt>Old system bills</dt><dd>{s.closed.legacyBillCount} (Chairside: {s.billCount})</dd></>) : null}
          </dl>
          {canReopen ? <ReopenForm branchId={branchId} date={today} /> : <p className="muted small">Only the owner can reopen a closed day.</p>}
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
