'use client';

import { useId, useState } from 'react';
import { addToQueueAction, closeRecallAction, setRecallAction } from '@/app/actions/frontdesk';
import { useActionForm } from '@/lib/nav/use-action-form';
import NotSent from '@/components/NotSent';

/** "Add to today's queue" on the patient page (T36). */
export function AddToQueue({ patientId }: { patientId: string }) {
  const { busy, notSent, send, release, navigate } = useActionForm('visit.add');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <>
      <button
        type="button"
        className="cta secondary-cta"
        disabled={busy}
        onClick={() =>
          void (async () => {
            setMsg(null);
            const res = await send(() => addToQueueAction(patientId));
            if (!res) return;
            if (!res.ok) {
              release();
              return setMsg({ ok: false, text: res.error });
            }
            setMsg({ ok: true, text: `Added to today’s queue: token ${res.data.token}.` });
            await navigate();
          })()
        }
      >
        {busy ? 'Adding…' : 'Add to today’s queue'}
      </button>
      {msg ? <span className={msg.ok ? 'small' : 'small err-text'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</span> : null}
      <NotSent message={notSent} />
    </>
  );
}

/** Set the next visit (T37): what for, and when. The date pre-fills from the kind. */
export function RecallForm({ patientId, kinds, defaults, min, max }: { patientId: string; kinds: { v: string; label: string }[]; defaults: Record<string, string>; min: string; max: string }) {
  const { busy, notSent, send, release, navigate } = useActionForm('recall.set');
  const [kind, setKind] = useState('checkup');
  const [dueOn, setDueOn] = useState(defaults.checkup ?? min);
  const [error, setError] = useState<string | null>(null);
  const dateId = useId();
  return (
    <form
      className="recall-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void (async () => {
          setError(null);
          const res = await send(() => setRecallAction(patientId, kind, dueOn));
          if (!res) return;
          if (!res.ok) {
            release();
            return setError(res.error);
          }
          await navigate();
        })();
      }}
    >
      <fieldset className="field">
        <legend>Next visit for</legend>
        <div className="chips" role="group">
          {kinds.map((k) => (
            <button
              key={k.v}
              type="button"
              className={`chip${kind === k.v ? ' on' : ''}`}
              aria-pressed={kind === k.v}
              onClick={() => {
                setKind(k.v);
                setDueOn(defaults[k.v] ?? dueOn);
              }}
            >
              {k.label}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor={dateId}>Due on</label>
        <input id={dateId} type="date" value={dueOn} min={min} max={max} onChange={(e) => setDueOn(e.target.value)} aria-invalid={!!error} aria-describedby={error ? `${dateId}-err` : undefined} />
      </div>
      <button className="secondary-btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Set next visit'}</button>
      {error ? <div className="hint err-text" id={`${dateId}-err`} role="alert">{error}</div> : null}
      <NotSent message={notSent} />
    </form>
  );
}

/** Close a recall: booked, or not needed (T37). */
export function CloseRecall({ recallId, label }: { recallId: string; label: string }) {
  const { busy, send, release, navigate } = useActionForm('recall.close');
  const [error, setError] = useState<string | null>(null);
  const act = (outcome: 'done' | 'cancelled') =>
    void (async () => {
      setError(null);
      const res = await send(() => closeRecallAction(recallId, outcome));
      if (!res) return;
      if (!res.ok) {
        release();
        return setError(res.error);
      }
      await navigate();
    })();
  return (
    <span className="visit-actions">
      <button type="button" className="linkish small" disabled={busy} aria-label={`Booked: ${label}`} onClick={() => act('done')}>Booked</button>
      <button type="button" className="linkish small" disabled={busy} aria-label={`Not needed: ${label}`} onClick={() => act('cancelled')}>Not needed</button>
      {error ? <span className="err-text small" role="alert">{error}</span> : null}
    </span>
  );
}
