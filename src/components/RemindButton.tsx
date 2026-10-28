'use client';

import { useId, useState } from 'react';
import { logReminderAction } from '@/app/actions/whatsapp';

/**
 * "Remind on WhatsApp" (Sprint 2, T32). The link is built on the server; this
 * opens it in a new tab and logs the reminder. While bills are in the Pilot 0
 * test series, the desk must first tick that it checked the amount in the old
 * software: a wrong reminder to a real patient is the risk this feature adds.
 */
export default function RemindButton({
  patientId,
  branchId,
  href,
  amountLabel,
  lastLabel,
  confirmOldSystem,
  compact = false,
}: {
  patientId: string;
  branchId: string;
  href: string | null;
  amountLabel: string;
  lastLabel: string | null;
  confirmOldSystem: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(!confirmOldSystem);
  const [last, setLast] = useState(lastLabel);
  const [error, setError] = useState<string | null>(null);
  const tick = useId();

  if (!href) return <span className="muted small">No mobile on file</span>;

  function opened() {
    setOpen(false);
    setError(null);
    void logReminderAction(patientId, branchId)
      .then((r) => (r.ok ? setLast('Reminded today') : setError(r.error)))
      .catch(() => setError('The reminder opened, but Chairside could not note it. It may not show as reminded.'));
  }

  const link = (
    <a className="link wa-btn" href={href} target="_blank" rel="noopener noreferrer" onClick={opened}>
      Open WhatsApp
    </a>
  );

  return (
    <span className="remind">
      {open && confirmOldSystem ? (
        <span className="remind-confirm" role="group" aria-label="Before you send">
          <label className="ack small" htmlFor={tick}>
            <input id={tick} type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> I checked {amountLabel} in our old software
          </label>{' '}
          {checked ? link : <span className="muted small">Tick to open WhatsApp</span>}{' '}
          <button type="button" className="linkish small" onClick={() => setOpen(false)}>Not now</button>
        </span>
      ) : confirmOldSystem ? (
        <button type="button" className="linkish wa-btn" onClick={() => setOpen(true)} aria-label={`Remind on WhatsApp about ${amountLabel}`}>
          {compact ? 'Remind' : 'Remind on WhatsApp'}
        </button>
      ) : (
        <a className="link wa-btn" href={href} target="_blank" rel="noopener noreferrer" onClick={opened} aria-label={`Remind on WhatsApp about ${amountLabel}`}>
          {compact ? 'Remind' : 'Remind on WhatsApp'}
        </a>
      )}
      {last ? <span className="reminded">{last}</span> : null}
      {error ? <span className="reminded err-text" role="alert">{error}</span> : null}
    </span>
  );
}
