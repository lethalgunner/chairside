'use client';

import Link from 'next/link';
import { useState } from 'react';
import { markArrivedAction, setAppointmentStatusAction } from '@/app/actions/appointments';
import type { AppointmentStatus } from '@/domain/appointments';
import { useActionForm } from '@/lib/nav/use-action-form';

/** The next steps for one appointment (LET-167). Cancel asks for a reason inline. */
export default function AppointmentActions({ id, status, isToday, label }: { id: string; status: AppointmentStatus; isToday: boolean; label: string }) {
  const { busy, notSent, send, release, navigate } = useActionForm('appointment.status');
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [token, setToken] = useState<number | null>(null);

  type Result = { ok: true; data?: { token: number | null } | undefined } | { ok: false; error: string };
  function go(call: () => Promise<Result>) {
    setError(null);
    void (async () => {
      const res = await send(call);
      if (!res) return;
      if (!res.ok) {
        release();
        return setError(res.error);
      }
      if (res.data?.token) setToken(res.data.token);
      setCancelling(false);
      await navigate();
    })();
  }

  const open = status === 'booked' || status === 'confirmed';
  return (
    <span className="appt-actions">
      {isToday && open ? (
        <button type="button" className="secondary-btn" disabled={busy} aria-label={`Arrived: ${label}`} onClick={() => go(() => markArrivedAction(id))}>Arrived</button>
      ) : null}
      {status === 'booked' ? (
        <button type="button" className="linkish small" disabled={busy} aria-label={`Confirm: ${label}`} onClick={() => go(() => setAppointmentStatusAction(id, 'confirmed'))}>Confirm</button>
      ) : null}
      {open ? (
        <>
          <Link className="linkish small" href={`/appointments/new?move=${id}`} aria-label={`Move: ${label}`}>Move</Link>
          {isToday ? (
            <button type="button" className="linkish small" disabled={busy} aria-label={`No-show: ${label}`} onClick={() => go(() => setAppointmentStatusAction(id, 'no_show'))}>No-show</button>
          ) : null}
          <button type="button" className="linkish small danger" disabled={busy} aria-label={`Cancel: ${label}`} onClick={() => setCancelling((c) => !c)}>Cancel</button>
        </>
      ) : null}
      {status === 'no_show' ? (
        <button type="button" className="linkish small" disabled={busy} aria-label={`Undo no-show: ${label}`} onClick={() => go(() => setAppointmentStatusAction(id, 'booked'))}>Undo no-show</button>
      ) : null}
      {status === 'arrived' ? <Link className="linkish small" href="/queue">{token ? `Token ${token} · ` : ''}Waiting room</Link> : null}
      {cancelling ? (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            go(() => setAppointmentStatusAction(id, 'cancelled', reason));
          }}
        >
          <label className="sr-only" htmlFor={`cancel-${id}`}>Why cancelled</label>
          <input id={`cancel-${id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? e.g. patient travelling" autoFocus maxLength={120} />
          <button type="submit" className="secondary-btn" disabled={busy}>Cancel appointment</button>
        </form>
      ) : null}
      {error ? <span className="err-text small" role="alert">{error}</span> : null}
      {notSent ? <span className="err-text small" role="alert">{notSent}</span> : null}
    </span>
  );
}
