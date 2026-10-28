'use client';

import { useState } from 'react';
import { voidInvoiceAction } from '@/app/actions/money';
import { useActionForm } from '@/lib/nav/use-action-form';
import NotSent from '@/components/NotSent';

/**
 * Cancel an unpaid bill. Its number stays used; a reversing entry clears the
 * patient's balance. When the bill's lines are recorded procedures, the
 * person must say whether the work was done (Q20, T28): "Yes" puts it back
 * under Done, not billed; "No" marks it not done with the cancel reason.
 */
export default function VoidForm({ invoiceId, number, hasProcedures }: { invoiceId: string; number: string; hasProcedures: boolean }) {
  const { busy: pending, notSent, send, release, navigate } = useActionForm('invoice.void');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [workDone, setWorkDone] = useState<boolean | null>(null);
  const answered = !hasProcedures || workDone !== null;
  if (!open) {
    return (
      <p>
        <button type="button" className="linkish danger" onClick={() => setOpen(true)}>Cancel this bill…</button>
      </p>
    );
  }
  return (
    <div className="card">
      <div className="body">
        <div className="field">
          <label htmlFor="void-reason">Why is {number} being cancelled?</label>
          <input id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Billed to the wrong patient" autoFocus />
        </div>
        {hasProcedures ? (
          <fieldset className="work-done">
            <legend>
              Was this work done? <span className="req">required</span>
            </legend>
            <label className="ack">
              <input type="radio" name="work-done" checked={workDone === true} onChange={() => setWorkDone(true)} />
              <span>Yes — it will show under Done, not billed</span>
            </label>
            <label className="ack">
              <input type="radio" name="work-done" checked={workDone === false} onChange={() => setWorkDone(false)} />
              <span>No — it wasn’t done</span>
            </label>
          </fieldset>
        ) : null}
        <p className="muted small">The bill keeps its number and shows as cancelled.</p>
        {error ? <div className="callout warn" role="alert">{error}</div> : null}
        <NotSent message={notSent} />
        <div className="actions">
          <button
            type="button"
            className="danger-btn"
            disabled={pending || reason.trim().length < 5 || !answered}
            onClick={() =>
              void (async () => {
                const res = await send(() => voidInvoiceAction(invoiceId, reason, workDone ?? true));
                if (!res) return;
                if (!res.ok) {
                  release();
                  return setError(res.error);
                }
                await navigate();
                setOpen(false);
              })()
            }
          >
            {pending ? 'Cancelling…' : `Cancel ${number}`}
          </button>
          <button type="button" className="secondary-btn" onClick={() => setOpen(false)}>Keep it</button>
        </div>
      </div>
    </div>
  );
}
