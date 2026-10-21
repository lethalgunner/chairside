'use client';

import { useState } from 'react';
import { cancelReceiptAction } from '@/app/actions/money';
import { useActionForm } from '@/lib/nav/use-action-form';

/** Owner only. The payment keeps its number and shows as cancelled; the bills it paid become due again. */
export default function CancelPaymentForm({ receiptId, number }: { receiptId: string; number: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { busy, send, release, navigate } = useActionForm('receipt.cancel');
  if (!open) {
    return (
      <p>
        <button type="button" className="linkish danger" onClick={() => setOpen(true)}>Cancel this payment…</button>
      </p>
    );
  }
  return (
    <div className="card">
      <div className="body">
        <div className="field">
          <label htmlFor="cancel-reason">Why is {number} being cancelled?</label>
          <input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Typed ₹5,000 instead of ₹500" autoFocus />
        </div>
        <p className="muted small">The payment keeps its number and shows as cancelled. Bills it paid show as due again, and today’s totals drop by this amount.</p>
        {error ? <div className="callout warn" role="alert">{error}</div> : null}
        <div className="actions">
          <button
            type="button"
            className="danger-btn"
            disabled={busy || reason.trim().length < 5}
            onClick={() =>
              void (async () => {
                const res = await send(() => cancelReceiptAction(receiptId, reason));
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
            {busy ? 'Cancelling…' : `Cancel ${number}`}
          </button>
          <button type="button" className="secondary-btn" onClick={() => setOpen(false)}>Keep it</button>
        </div>
      </div>
    </div>
  );
}
