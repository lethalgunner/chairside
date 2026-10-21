'use client';

import { useState } from 'react';
import { reopenDayAction } from '@/app/actions/money';
import { useActionForm } from '@/lib/nav/use-action-form';

export default function ReopenForm({ branchId, date }: { branchId: string; date: string }) {
  const { busy: pending, send, release, navigate } = useActionForm('day.reopen');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="inline-form">
      <label className="sr-only" htmlFor="reopen-reason">Reason for reopening</label>
      <input id="reopen-reason" placeholder="Why reopen? (owner only, recorded)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button
        type="button"
        className="secondary-btn"
        disabled={pending || reason.trim().length < 5}
        onClick={() =>
          void (async () => {
            const res = await send(() => reopenDayAction(branchId, date, reason));
            if (!res) return;
            if (!res.ok) {
              release();
              return setError(res.error);
            }
            await navigate();
          })()
        }
      >
        Reopen day
      </button>
      {error ? <span className="variance-bad small" role="alert">{error}</span> : null}
    </div>
  );
}
