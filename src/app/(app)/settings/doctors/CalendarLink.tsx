'use client';

import { useState } from 'react';
import { calendarLinkAction } from '@/app/actions/settings';
import { useActionForm } from '@/lib/nav/use-action-form';

/**
 * A private calendar link for one doctor (LET-170). Shown once: we keep only a
 * hash, so a lost link is replaced, not recovered. The feed has times and the
 * branch, never patient names.
 */
export default function CalendarLink({ providerId, name, hasLink }: { providerId: string; name: string; hasLink: boolean }) {
  const { busy, send, release } = useActionForm('provider.calendar_link');
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [active, setActive] = useState(hasLink);

  function act(revoke: boolean) {
    setError(null);
    setCopied(false);
    void (async () => {
      const res = await send(() => calendarLinkAction(providerId, revoke));
      release();
      if (!res) return;
      if (!res.ok) return setError(res.error);
      setActive(!revoke);
      setUrl(res.data.token ? `${window.location.origin}/calendar/${res.data.token}` : null);
    })();
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      /* clipboard blocked: the link is selectable */
    }
  }

  return (
    <div className="cal-link">
      {url ? (
        <div className="callout" role="status">
          <strong>Calendar link for {name}</strong>
          <div className="hint">Shown once. In Google Calendar: Other calendars → From URL. On iPhone: Settings → Calendar → Accounts → Add Subscribed Calendar. It shows times and the branch, never patient names.</div>
          <input className="mono wide" readOnly value={url} aria-label={`Calendar link for ${name}`} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="linkish" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy link'}</button>
        </div>
      ) : null}
      {error ? <div className="callout warn" role="alert">{error}</div> : null}
      <span className="muted small">Calendar: {active ? 'link active' : 'no link'}</span>{' '}
      <button type="button" className="linkish" disabled={busy} onClick={() => act(false)}>{active ? 'New link (old one stops)' : 'Create calendar link'}</button>
      {active ? (
        <>
          {' '}
          <button type="button" className="linkish" disabled={busy} onClick={() => act(true)}>Turn off</button>
        </>
      ) : null}
    </div>
  );
}
