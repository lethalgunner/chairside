'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { reopenDayAction } from '@/app/actions/money';

export default function ReopenForm({ branchId, date }: { branchId: string; date: string }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="inline-form">
      <label className="sr-only" htmlFor="reopen-reason">Reason for reopening</label>
      <input id="reopen-reason" placeholder="Why reopen? (owner only, recorded)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button
        type="button"
        className="secondary-btn"
        disabled={pending || reason.trim().length < 5}
        onClick={() =>
          start(async () => {
            const res = await reopenDayAction(branchId, date, reason);
            if (!res.ok) return setError(res.error);
            router.refresh();
          })
        }
      >
        Reopen day
      </button>
      {error ? <span className="variance-bad small" role="alert">{error}</span> : null}
    </div>
  );
}
