'use client';

import { useState } from 'react';
import { voidInvoiceAction } from '@/app/actions/money';
import { useActionForm } from '@/lib/nav/use-action-form';

/** Cancel an unpaid bill. Its number stays used; a reversing entry clears the patient's balance. */
export default function VoidForm({ invoiceId, number }: { invoiceId: string; number: string }) {
  const { busy: pending, send, release, navigate } = useActionForm('invoice.void');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
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
        <p className="muted small">The bill keeps its number and shows as cancelled. Any procedures on it go back to “Done, not billed”.</p>
        {error ? <div className="callout warn" role="alert">{error}</div> : null}
        <div className="actions">
          <button
            type="button"
            className="danger-btn"
            disabled={pending || reason.trim().length < 5}
            onClick={() =>
              void (async () => {
                const res = await send(() => voidInvoiceAction(invoiceId, reason));
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
