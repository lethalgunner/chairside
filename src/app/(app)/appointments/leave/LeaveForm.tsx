'use client';

import { useState } from 'react';
import { addLeaveAction, removeLeaveAction } from '@/app/actions/appointments';
import { useActionForm } from '@/lib/nav/use-action-form';
import NotSent from '@/components/NotSent';

export default function LeaveForm({ doctors, today }: { doctors: { id: string; name: string }[]; today: string }) {
  const { busy, notSent, send, release, navigate } = useActionForm('provider.leave_add');
  const [providerId, setProviderId] = useState(doctors.length === 1 ? doctors[0]!.id : '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const err = (k: string) => (errors[k] ? <div className="hint err-text" id={`lv-${k}-err`}>{errors[k]}</div> : null);
  const aria = (k: string) => ({ 'aria-invalid': !!errors[k], 'aria-describedby': errors[k] ? `lv-${k}-err` : undefined, className: errors[k] ? 'err' : undefined });

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    if (!providerId) return setErrors({ providerId: 'Pick a doctor.' });
    void (async () => {
      const res = await send(() => addLeaveAction(providerId, { from, to, note }));
      if (!res) return;
      release();
      if (!res.ok) return setError(res.error);
      if (!res.data.ok) return setErrors(res.data.fieldErrors);
      const name = doctors.find((d) => d.id === providerId)?.name ?? 'Leave';
      setDone(res.data.toMove > 0 ? `${name}: leave saved. ${res.data.toMove} appointment${res.data.toMove === 1 ? '' : 's'} to move, listed below.` : `${name}: leave saved. Nothing was booked on those days.`);
      setErrors({});
      setFrom('');
      setTo('');
      setNote('');
      await navigate();
    })();
  }

  return (
    <form className="card" onSubmit={save} noValidate aria-label="Add leave">
      <header><h2>Add leave</h2></header>
      <div className="body">
        <div className="field-grid">
          <div className="field">
            <label htmlFor="lv-doctor">Doctor</label>
            <select id="lv-doctor" value={providerId} onChange={(e) => setProviderId(e.target.value)} {...aria('providerId')}>
              <option value="">Choose…</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            {err('providerId')}
          </div>
          <div className="field">
            <label htmlFor="lv-from">First day away</label>
            <input id="lv-from" type="date" min={today} value={from} onChange={(e) => setFrom(e.target.value)} {...aria('from')} />
            {err('from')}
          </div>
          <div className="field">
            <label htmlFor="lv-to">Last day away <span className="muted small">(blank = one day)</span></label>
            <input id="lv-to" type="date" min={from || today} value={to} onChange={(e) => setTo(e.target.value)} {...aria('to')} />
            {err('to')}
          </div>
          <div className="field">
            <label htmlFor="lv-note">Note <span className="muted small">(optional)</span></label>
            <input id="lv-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} autoComplete="off" {...aria('note')} />
            {err('note')}
          </div>
        </div>
        {done ? <div className="callout good" role="status">{done}</div> : null}
        {error ? <div className="callout warn" role="alert">{error}</div> : null}
        <NotSent message={notSent} />
        <div className="actions">
          <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save leave'}</button>
        </div>
      </div>
    </form>
  );
}

export function RemoveLeave({ id, label }: { id: string; label: string }) {
  const { busy, send, release, navigate } = useActionForm('provider.leave_remove');
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="linkish small"
        disabled={busy}
        aria-label={`Remove leave: ${label}`}
        onClick={() =>
          void (async () => {
            setError(null);
            const res = await send(() => removeLeaveAction(id));
            if (!res) return;
            if (!res.ok) {
              release();
              return setError(res.error);
            }
            await navigate();
          })()
        }
      >
        Remove
      </button>
      {error ? <span className="err-text small" role="alert"> {error}</span> : null}
    </>
  );
}
