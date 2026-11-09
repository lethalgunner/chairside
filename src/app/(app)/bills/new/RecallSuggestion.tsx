'use client';

import { useState } from 'react';
import { setRecallAction } from '@/app/actions/frontdesk';
import { dueInWords, RECALL_LABEL, type RecallKind } from '@/domain/visits';
import { useActionForm } from '@/lib/nav/use-action-form';

/**
 * After a bill (Sprint 8): "Scaling usually means a cleaning in about 6 months,
 * set a reminder?" One tap; it replaces this patient's reminder at the branch,
 * as setting one on the patient page does. Nothing happens unless pressed.
 */
export default function RecallSuggestion({ patientId, patientName, itemName, kind, dueOn, today }: { patientId: string; patientName: string; itemName: string; kind: RecallKind; dueOn: string; today: string }) {
  const { busy, send, release } = useActionForm('recall.set');
  const [state, setState] = useState<'idle' | 'set' | 'error'>('idle');
  if (state === 'set') return <div className="callout good" role="status">Reminder set: {RECALL_LABEL[kind]} {dueInWords(today, dueOn)}.</div>;
  return (
    <div className="callout" role="note">
      {itemName}: remind {patientName} to come back for a {RECALL_LABEL[kind].toLowerCase()} {dueInWords(today, dueOn)}?{' '}
      <button
        type="button"
        className="secondary-btn"
        disabled={busy}
        onClick={() =>
          void (async () => {
            const res = await send(() => setRecallAction(patientId, kind, dueOn));
            release();
            if (!res) return;
            setState(res.ok ? 'set' : 'error');
          })()
        }
      >
        {busy ? 'Saving…' : 'Set reminder'}
      </button>
      {state === 'error' ? <span className="err-text small"> Not saved. Set it on the patient page.</span> : null}
    </div>
  );
}
