'use client';

import { useState } from 'react';
import { moveVisitAction } from '@/app/actions/frontdesk';
import { useActionForm } from '@/lib/nav/use-action-form';
import type { VisitStatus } from '@/domain/visits';

const STEPS: Record<VisitStatus, { to: VisitStatus; label: string; kind: 'primary' | 'plain' }[]> = {
  waiting: [
    { to: 'in_chair', label: 'Seat', kind: 'primary' },
    { to: 'left', label: 'Left without being seen', kind: 'plain' },
  ],
  in_chair: [
    { to: 'done', label: 'Done', kind: 'primary' },
    { to: 'waiting', label: 'Back to waiting', kind: 'plain' },
  ],
  done: [],
  left: [],
};

/** The next step for one patient in the waiting room (T36). */
export default function VisitActions({ visitId, status, token }: { visitId: string; status: VisitStatus; token: number }) {
  const { busy, notSent, send, release, navigate } = useActionForm('visit.move');
  const [error, setError] = useState<string | null>(null);
  const steps = STEPS[status];
  if (steps.length === 0) return null;
  return (
    <span className="visit-actions">
      {steps.map((s) => (
        <button
          key={s.to}
          type="button"
          className={s.kind === 'primary' ? 'secondary-btn' : 'linkish small'}
          disabled={busy}
          aria-label={`${s.label}: token ${token}`}
          onClick={() =>
            void (async () => {
              setError(null);
              const res = await send(() => moveVisitAction(visitId, s.to));
              if (!res) return;
              if (!res.ok) {
                release();
                return setError(res.error);
              }
              await navigate();
            })()
          }
        >
          {s.label}
        </button>
      ))}
      {error ? <span className="err-text small" role="alert">{error}</span> : null}
      {notSent ? <span className="err-text small" role="alert">{notSent}</span> : null}
    </span>
  );
}
