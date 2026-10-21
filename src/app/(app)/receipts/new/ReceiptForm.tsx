'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { recordReceiptAction } from '@/app/actions/money';
import { allocateReceipt, type OutstandingInvoice } from '@/domain/ledger';
import { add, formatINR, fromRupeeString, subtract, type Paise } from '@/domain/money';
import { MODE_LABEL } from '@/components/ui';
import { useActionForm } from '@/lib/nav/use-action-form';

const MODES = ['cash', 'upi', 'card', 'bank_transfer', 'cheque', 'financing'] as const;

interface Props {
  patient: { id: string; name: string };
  branchName: string;
  open: (OutstandingInvoice & { number: string })[];
  balancePaise: Paise;
}

/** The allocation is spelled out as a sentence before saving, so the desk sees the reasoning instead of trusting it. */
export default function ReceiptForm({ patient, branchName, open, balancePaise }: Props) {
  const { busy: pending, send, release } = useActionForm('receipt.record');
  const idem = useRef<string>(crypto.randomUUID());
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<(typeof MODES)[number]>('cash');
  const [reference, setReference] = useState('');
  const [keepAdvance, setKeepAdvance] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const due = add(...open.map((o) => subtract(o.totalPaise, o.allocatedPaise)));
  const parsed = useMemo(() => {
    if (!amount.trim()) return null;
    try {
      const v = fromRupeeString(amount);
      return v > 0 ? v : null;
    } catch {
      return null;
    }
  }, [amount]);
  const plan = parsed ? allocateReceipt(parsed, open) : null;
  const needsAdvanceOk = !!plan && plan.unallocatedPaise > 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!parsed) return setError('Enter the amount received in rupees, like 2000 or 2000.50.');
    if (needsAdvanceOk && !keepAdvance) return setError('Confirm that the extra amount should be kept as an advance.');
    void (async () => {
      const res = await send(() => recordReceiptAction({ patientId: patient.id, amountPaise: parsed, mode, reference: reference.trim() || undefined, idempotencyKey: idem.current }));
      if (!res) return;
      release();
      if (!res.ok) return setError(res.error);
      setDone(res.data.number);
    })();
  }

  if (done) {
    return (
      <div className="card">
        <div className="body">
          <div className="callout good" role="status">
            Payment <strong className="mono">{done}</strong> of {formatINR(parsed!)} recorded at {branchName}.
          </div>
          <div className="actions">
            <Link className="primary-link" href={`/patients/${patient.id}`}>Back to {patient.name}</Link>
            <Link className="secondary" href="/patients">Next patient</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={submit} noValidate>
      <div className="body">
        <p className="muted">
          {due > 0 ? <>Open bills at {branchName}: <strong>{formatINR(due)}</strong>.</> : <>No open bills at {branchName}.</>}{' '}
          {balancePaise < 0 ? <>Already paid in advance: {formatINR(Math.abs(balancePaise) as Paise)}.</> : null}
        </p>
        <div className="field-grid">
          <div className="field">
            <label htmlFor="amount">Amount received (₹)</label>
            <input id="amount" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setKeepAdvance(false); }} autoFocus placeholder={due > 0 ? String(due / 100) : ''} />
            {due > 0 ? (
              <button type="button" className="linkish small" onClick={() => setAmount((due / 100).toFixed(2).replace(/\.00$/, ''))}>
                Fill full amount due
              </button>
            ) : null}
          </div>
          <fieldset className="field">
            <legend>Paid by</legend>
            <div className="chips" role="group">
              {MODES.map((m) => (
                <button key={m} type="button" className={`chip${mode === m ? ' on' : ''}`} aria-pressed={mode === m} onClick={() => setMode(m)}>
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
          </fieldset>
          {mode !== 'cash' ? (
            <div className="field span2">
              <label htmlFor="reference">{mode === 'upi' ? 'UPI ID or transaction ref' : mode === 'card' ? 'Card terminal / approval code' : 'Reference'} (optional)</label>
              <input id="reference" value={reference} onChange={(e) => setReference(e.target.value)} autoComplete="off" />
            </div>
          ) : null}
        </div>

        {plan ? (
          <div className="callout" aria-live="polite">
            {plan.allocations.length > 0 ? (
              <>
                This {formatINR(parsed!)} will settle{' '}
                {plan.allocations
                  .map((a) => {
                    const inv = open.find((o) => o.invoiceId === a.invoiceId)!;
                    const full = a.amountPaise === subtract(inv.totalPaise, inv.allocatedPaise);
                    return `${full ? 'all' : formatINR(a.amountPaise)} of ${inv.number}${full ? '' : ` (leaving ${formatINR(subtract(subtract(inv.totalPaise, inv.allocatedPaise), a.amountPaise))})`}`;
                  })
                  .join(', ')}
                .
              </>
            ) : (
              <>There is nothing open to settle.</>
            )}
            {plan.unallocatedPaise > 0 ? (
              <label className="ack">
                <input type="checkbox" checked={keepAdvance} onChange={(e) => setKeepAdvance(e.target.checked)} /> Keep the extra <strong>{formatINR(plan.unallocatedPaise)}</strong> as an advance for future treatment.
              </label>
            ) : null}
          </div>
        ) : null}

        {error ? <div className="callout warn" role="alert">{error}</div> : null}
        <div className="actions">
          <button className="primary" type="submit" disabled={pending || !parsed}>
            {pending ? 'Saving…' : parsed ? `Record ${formatINR(parsed)} ${MODE_LABEL[mode]}` : 'Record payment'}
          </button>
          <Link className="secondary" href={`/patients/${patient.id}`}>Cancel</Link>
        </div>
      </div>
    </form>
  );
}
