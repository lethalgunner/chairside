'use client';

import { useState } from 'react';
import { setMessagesStoppedAction } from '@/app/actions/messages';
import { useActionForm } from '@/lib/nav/use-action-form';

/** "Patient said STOP" (Sprint 8): no planned reminders under any rule. The manual WhatsApp buttons stay. */
export default function StopReminders({ patientId, stopped }: { patientId: string; stopped: boolean }) {
  const { busy, send, release, navigate } = useActionForm('patient.messages_stop');
  const [error, setError] = useState<string | null>(null);
  const toggle = () =>
    void (async () => {
      setError(null);
      const res = await send(() => setMessagesStoppedAction(patientId, !stopped));
      if (!res) return;
      if (!res.ok) {
        release();
        return setError(res.error);
      }
      await navigate();
    })();
  return (
    <p className="small" role="status">
      {stopped ? <><span className="pill credit">Reminders stopped</span> The patient asked for no reminders. </> : <span className="muted">Automatic reminders on. </span>}
      <button type="button" className="linkish small" disabled={busy} onClick={toggle}>{stopped ? 'Turn reminders back on' : 'Patient said STOP'}</button>
      {error ? <span className="err-text small" role="alert"> {error}</span> : null}
    </p>
  );
}
