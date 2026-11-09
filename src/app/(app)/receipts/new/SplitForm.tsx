'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { recordSplitReceiptAction } from '@/app/actions/money';
import { allocateReceipt, type OutstandingInvoice } from '@/domain/ledger';
import { add, formatINR, parseRupeesInput, subtract, type Paise } from '@/domain/money';
import { MODE_LABEL } from '@/components/ui';
import { useActionForm } from '@/lib/nav/use-action-form';
import NotSent from '@/components/NotSent';

const MODES = ['cash', 'upi', 'card', 'bank_transfer', 'cheque', 'financing'] as const;
type Mode = (typeof MODES)[number];
interface Part {
  amount: string;
  mode: Mode;
  reference: string;
}

/**
 * Split payment (Sprint 9): "₹2,000 cash and the rest on UPI" in one go.
 * One receipt per way, saved together; day close counts each way as before.
 */
export default function SplitForm({ patient, branchName, open, onCancel }: { patient: { id: string; name: string }; branchName: string; open: (OutstandingInvoice & { number: string })[]; onCancel: () => void }) {
  const { busy, notSent, send, release } = useActionForm('receipt.record_split');
  const idem = useRef<string>(crypto.randomUUID());
  const [parts, setParts] = useState<Part[]>([
    { amount: '', mode: 'cash', reference: '' },
    { amount: '', mode: 'upi', reference: '' },
  ]);
  const [keepAdvance, setKeepAdvance] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ numbers: string[]; total: Paise } | null>(null);
  const due = add(...open.map((o) => subtract(o.totalPaise, o.allocatedPaise)));

  const parsed = useMemo(
    () =>
      parts.map((p, i) => {
        if (!p.amount.trim()) return { paise: null, error: null };
        const r = parseRupeesInput(p.amount, `amount ${i + 1}`);
        if (!r.ok) return { paise: null, error: r.error };
        if (r.paise <= 0) return { paise: null, error: 'Enter more than ₹0.' };
        return { paise: r.paise, error: null };
      }),
    [parts],
  );
  const allGood = parsed.every((p) => p.paise !== null);
  const total = allGood ? add(...parsed.map((p) => p.paise!)) : null;
  const repeated = new Set(parts.map((p) => p.mode)).size !== parts.length;
  const plan = total ? allocateReceipt(total, open) : null;
  const needsAdvanceOk = !!plan && plan.unallocatedPaise > 0;

  const set = (i: number, patch: Partial<Part>) => {
    setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
    setKeepAdvance(false);
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!allGood || !total) return setError('Enter every amount in rupees, like 2000 or 2000.50.');
    if (repeated) return setError('Each way of paying once: add the amounts for the same way together.');
    if (needsAdvanceOk && !keepAdvance) return setError('Confirm that the extra amount should be kept as an advance.');
    void (async () => {
      const res = await send(() =>
        recordSplitReceiptAction({ patientId: patient.id, idempotencyKey: idem.current, parts: parts.map((p, i) => ({ mode: p.mode, amountPaise: parsed[i]!.paise!, reference: p.reference.trim() || undefined })) }),
      );
      if (!res) return;
      release();
      if (!res.ok) return setError(res.error);
      setDone({ numbers: res.data.receipts.map((r) => r.number), total });
    })();
  }

  if (done) {
    return (
      <div className="card">
        <div className="body">
          <div className="callout good" role="status">
            {formatINR(done.total)} recorded at {branchName} in {done.numbers.length} ways: <strong className="mono">{done.numbers.join(', ')}</strong>.
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
    <form className="card" onSubmit={submit} noValidate aria-label="Split payment">
      <header><h2>Paid more than one way</h2></header>
      <div className="body">
        <p className="muted">{due > 0 ? <>Open bills at {branchName}: <strong>{formatINR(due)}</strong>.</> : <>No open bills at {branchName}.</>}</p>
        {parts.map((p, i) => (
          <fieldset key={i} className="field split-part">
            <legend>Way {i + 1}</legend>
            <div className="field-grid">
              <div className="field">
                <label htmlFor={`sp-amt-${i}`}>Amount (₹)</label>
                <input id={`sp-amt-${i}`} inputMode="decimal" value={p.amount} onChange={(e) => set(i, { amount: e.target.value })} aria-invalid={!!parsed[i]!.error} aria-describedby={parsed[i]!.error ? `sp-amt-${i}-err` : undefined} className={parsed[i]!.error ? 'err' : undefined} />
                {parsed[i]!.error ? <div className="hint err-text" id={`sp-amt-${i}-err`}>{parsed[i]!.error}</div> : null}
                {i === parts.length - 1 && due > 0 && parts.slice(0, -1).every((_, j) => parsed[j]!.paise) ? (
                  <button type="button" className="linkish small" onClick={() => { const rest = subtract(due, add(...parsed.slice(0, -1).map((x) => x.paise!))); if (rest > 0) set(i, { amount: (rest / 100).toFixed(2).replace(/\.00$/, '') }); }}>
                    Fill the rest
                  </button>
                ) : null}
              </div>
              <div className="field">
                <label htmlFor={`sp-mode-${i}`}>Paid by</label>
                <select id={`sp-mode-${i}`} value={p.mode} onChange={(e) => set(i, { mode: e.target.value as Mode })}>
                  {MODES.map((m) => (
                    <option key={m} value={m}>{MODE_LABEL[m]}</option>
                  ))}
                </select>
              </div>
              {p.mode !== 'cash' ? (
                <div className="field">
                  <label htmlFor={`sp-ref-${i}`}>Reference (optional)</label>
                  <input id={`sp-ref-${i}`} value={p.reference} maxLength={80} onChange={(e) => set(i, { reference: e.target.value })} autoComplete="off" />
                </div>
              ) : null}
            </div>
            {parts.length > 2 ? (
              <button type="button" className="linkish small" onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}>Remove way {i + 1}</button>
            ) : null}
          </fieldset>
        ))}
        {parts.length < 4 ? (
          <button type="button" className="secondary-btn" onClick={() => setParts((ps) => [...ps, { amount: '', mode: MODES.find((m) => !ps.some((p) => p.mode === m)) ?? 'card', reference: '' }])}>+ Another way</button>
        ) : null}
        {repeated ? <div className="hint err-text">The same way appears twice: add those amounts together.</div> : null}

        {plan && total ? (
          <div className="callout" aria-live="polite">
            Total {formatINR(total)}.{' '}
            {plan.allocations.length > 0 ? `It settles ${plan.allocations.map((a) => open.find((o) => o.invoiceId === a.invoiceId)!.number).join(', ')}.` : 'There is nothing open to settle.'}
            {plan.unallocatedPaise > 0 ? (
              <label className="ack">
                <input type="checkbox" checked={keepAdvance} onChange={(e) => setKeepAdvance(e.target.checked)} /> Keep the extra <strong>{formatINR(plan.unallocatedPaise)}</strong> as an advance for future treatment.
              </label>
            ) : null}
          </div>
        ) : null}

        {error ? <div className="callout warn" role="alert">{error}</div> : null}
        <NotSent message={notSent} />
        <div className="actions">
          <button className="primary" type="submit" disabled={busy || !total || repeated}>
            {busy ? 'Saving…' : total ? `Record ${formatINR(total)} in ${parts.length} ways` : 'Record payment'}
          </button>
          <button type="button" className="secondary-btn" onClick={onCancel} disabled={busy}>Back to one way</button>
        </div>
      </div>
    </form>
  );
}
