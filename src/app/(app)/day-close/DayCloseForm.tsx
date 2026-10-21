'use client';

import { useMemo, useState } from 'react';
import { closeDayAction, recordCashOutAction } from '@/app/actions/money';
import { formatINR, parseRupeesInput, subtract, type Paise } from '@/domain/money';
import { compareWithLegacy } from '@/domain/parallel';
import LegacyCompare from '@/components/LegacyCompare';
import { useActionForm } from '@/lib/nav/use-action-form';

interface Props {
  denominations: number[];
  expectedCashPaise: Paise;
  tolerancePaise: Paise;
  billCount: number;
  collectedPaise: Paise;
  canCashOut: boolean;
}

const COINS = new Set([1, 2, 5, 10, 20]);

export default function DayCloseForm({ denominations, expectedCashPaise, tolerancePaise, billCount, collectedPaise, canCashOut }: Props) {
  const closing = useActionForm('day.close');
  const cashOut = useActionForm('cash.out');
  const pending = closing.busy || cashOut.busy;
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [legacyCount, setLegacyCount] = useState('');
  const [legacyAmount, setLegacyAmount] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cashAmt, setCashAmt] = useState('');
  const [cashWhat, setCashWhat] = useState('');
  const [cashMsg, setCashMsg] = useState<string | null>(null);

  const counted = useMemo(
    () => denominations.reduce((s, d) => s + d * 100 * (Number(counts[String(d)] || 0) || 0), 0) as Paise,
    [counts, denominations],
  );
  const touched = Object.values(counts).some((v) => v !== '');
  const variance = subtract(counted, expectedCashPaise);
  const needsReason = Math.abs(variance) > tolerancePaise;
  const legacyN = legacyCount === '' ? null : Number(legacyCount);
  const legacyParsed = legacyAmount.trim() ? parseRupeesInput(legacyAmount, 'the old system’s collection') : null;
  const legacyP = legacyParsed?.ok ? legacyParsed.paise : null;
  const cashParsed = cashAmt.trim() ? parseRupeesInput(cashAmt, 'the amount paid out') : null;
  const comparison = compareWithLegacy({ legacyBillCount: legacyN, legacyCollectedPaise: legacyP, billCount, collectedPaise });

  function close() {
    setError(null);
    if (!touched) return setError('Count the cash in the drawer first (enter 0 if it is empty).');
    if (needsReason && reason.trim().length < 5) return setError('Write what happened to the difference before closing.');
    if (!confirming) return setConfirming(true);
    const denoms: Record<string, number> = {};
    for (const d of denominations) denoms[String(d)] = Number(counts[String(d)] || 0) || 0;
    void (async () => {
      const res = await closing.send(() => closeDayAction({ denominations: denoms, varianceReason: reason || undefined, legacyBillCount: legacyCount || undefined, legacyCollected: legacyAmount || undefined }));
      if (!res) return;
      if (!res.ok) {
        closing.release();
        setConfirming(false);
        return setError(res.error);
      }
      await closing.navigate();
    })();
  }

  return (
    <>
      {canCashOut ? (
        <div className="card">
          <header><h2>Cash paid out of the drawer</h2></header>
          <div className="body">
            <div className="inline-form">
              <label className="sr-only" htmlFor="cash-amt">Amount paid out in rupees</label>
              <input id="cash-amt" inputMode="decimal" placeholder="₹" className="small-in" value={cashAmt} onChange={(e) => setCashAmt(e.target.value)} aria-invalid={!!cashParsed && !cashParsed.ok} aria-describedby={cashParsed && !cashParsed.ok ? 'cash-amt-err' : undefined} />
              <label className="sr-only" htmlFor="cash-what">What it was for</label>
              <input id="cash-what" placeholder="What for (e.g. courier, tea)" value={cashWhat} onChange={(e) => setCashWhat(e.target.value)} />
              <button
                type="button"
                className="secondary-btn"
                disabled={pending || !cashParsed?.ok || !cashWhat}
                onClick={() =>
                  void (async () => {
                    const res = await cashOut.send(() => recordCashOutAction(cashAmt, cashWhat));
                    if (!res) return;
                    if (!res.ok) {
                      cashOut.release();
                      return setCashMsg(res.error);
                    }
                    setCashAmt('');
                    setCashWhat('');
                    setCashMsg('Recorded.');
                    await cashOut.navigate();
                  })()
                }
              >
                Add
              </button>
            </div>
            {cashParsed && !cashParsed.ok ? <p className="small err-text" id="cash-amt-err">{cashParsed.error}</p> : null}
            {cashMsg ? <p className="small muted" role="status">{cashMsg}</p> : null}
          </div>
        </div>
      ) : null}

      <div className="card">
        <header><h2>Count the drawer</h2><span className="note">Should be {formatINR(expectedCashPaise)}</span></header>
        <div className="body">
          <div className="denoms">
            {denominations.map((d) => (
              <div className="denom" key={d}>
                <label htmlFor={`d${d}`} className="d">₹{d} {COINS.has(d) && d !== 20 ? 'coins' : d === 20 ? 'notes/coins' : 'notes'}</label>
                <input id={`d${d}`} inputMode="numeric" className="c" value={counts[String(d)] ?? ''} onChange={(e) => { setCounts((c) => ({ ...c, [String(d)]: e.target.value.replace(/\D/g, '').slice(0, 5) })); setConfirming(false); }} />
              </div>
            ))}
          </div>
          <p className="big-line" aria-live="polite">
            Counted <strong>{formatINR(counted)}</strong> ·{' '}
            {!touched ? <span className="muted">enter the count</span> : variance === 0 ? <span className="variance-ok">matches exactly</span> : <span className={needsReason ? 'variance-bad' : 'variance-ok'}>{variance > 0 ? 'over' : 'short'} by {formatINR(Math.abs(variance) as Paise)}</span>}
          </p>
          {touched && needsReason ? (
            <div className="field">
              <label htmlFor="reason">What happened to the difference? <span className="req">required</span></label>
              <input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          ) : null}

          <fieldset className="tally">
            <legend>Check against the old system (pilot)</legend>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="legacy-count">Bills in the old system today</label>
                <input id="legacy-count" inputMode="numeric" value={legacyCount} onChange={(e) => setLegacyCount(e.target.value.replace(/\D/g, ''))} />
              </div>
              <div className="field">
                <label htmlFor="legacy-amt">Collected in the old system (₹)</label>
                <input id="legacy-amt" inputMode="decimal" value={legacyAmount} onChange={(e) => setLegacyAmount(e.target.value)} aria-invalid={!!legacyParsed && !legacyParsed.ok} aria-describedby={legacyParsed && !legacyParsed.ok ? 'legacy-amt-err' : undefined} />
                {legacyParsed && !legacyParsed.ok ? <div className="hint err-text" id="legacy-amt-err">{legacyParsed.error}</div> : null}
              </div>
            </div>
            {comparison ? <LegacyCompare c={comparison} /> : null}
            {comparison && comparison.bills.diff !== null && comparison.bills.diff < 0 ? (
              <p className="small muted">Add the missing bills before closing if you can.</p>
            ) : null}
          </fieldset>

          {error ? <div className="callout warn" role="alert">{error}</div> : null}
          {confirming ? (
            <div className="callout confirm" role="alert">
              Close today with <strong>{formatINR(counted)}</strong> counted ({variance === 0 ? 'no difference' : `${variance > 0 ? 'over' : 'short'} by ${formatINR(Math.abs(variance) as Paise)}`})? Nothing more can be billed or received today unless the owner reopens it.
            </div>
          ) : null}
          <div className="actions">
            <button className="primary" type="button" disabled={pending} onClick={close}>
              {pending ? 'Closing…' : confirming ? 'Yes, close the day' : 'Close the day'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
