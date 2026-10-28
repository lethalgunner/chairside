'use client';

import { useState } from 'react';
import { dismissProcedureAction } from '@/app/actions/money';
import { useActionForm } from '@/lib/nav/use-action-form';
import NotSent from '@/components/NotSent';

/**
 * "Not done: remove" on one Unbilled row (Q20, T28). Owner or branch manager
 * only (the page shows it only to them, the service checks again). The row is
 * marked not done with the reason, never deleted.
 */
export default function DismissForm({ procedureId, itemName }: { procedureId: string; itemName: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { busy, notSent, send, release, navigate } = useActionForm('procedure.dismiss');
  const id = `dismiss-${procedureId}`;
  if (!open) {
    return (
      <button type="button" className="linkish danger" onClick={() => setOpen(true)}>
        Not done: remove
      </button>
    );
  }
  return (
    <div className="dismiss-form">
      <label htmlFor={id}>Why wasn’t {itemName} done?</label>
      <input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Patient left before treatment" autoFocus />
      {error ? <span className="variance-bad small" role="alert">{error}</span> : null}
      <NotSent message={notSent} />
      <span className="dismiss-actions">
        <button
          type="button"
          className="danger-btn"
          disabled={busy || reason.trim().length < 5}
          onClick={() =>
            void (async () => {
              const res = await send(() => dismissProcedureAction(procedureId, reason));
              if (!res) return;
              if (!res.ok) {
                release();
                return setError(res.error);
              }
              await navigate();
            })()
          }
        >
          {busy ? 'Removing…' : 'Remove'}
        </button>
        <button type="button" className="secondary-btn" onClick={() => setOpen(false)}>
          Keep it
        </button>
      </span>
    </div>
  );
}
