'use client';

import { useState } from 'react';
import { markMessageAction } from '@/app/actions/messages';
import { useActionForm } from '@/lib/nav/use-action-form';

/**
 * Send opens WhatsApp in a new tab with the text ready and records the send;
 * the desk presses send in WhatsApp. Skip records that it wasn't sent.
 */
export default function MessageActions({ itemKey, href, label }: { itemKey: string; href: string | null; label: string }) {
  const { busy, send, release, navigate } = useActionForm('message.mark');
  const [error, setError] = useState<string | null>(null);

  function mark(outcome: 'sent' | 'skipped') {
    setError(null);
    void (async () => {
      const res = await send(() => markMessageAction(itemKey, outcome));
      if (!res) return;
      if (!res.ok) {
        release();
        return setError(res.error);
      }
      await navigate();
    })();
  }

  return (
    <div className="msg-actions">
      {href ? (
        <a className="cta small" href={href} target="_blank" rel="noopener noreferrer" aria-label={`Send on WhatsApp: ${label}`} aria-disabled={busy} onClick={() => mark('sent')}>
          Send
        </a>
      ) : (
        <span className="muted small">No WhatsApp number</span>
      )}
      <button type="button" className="linkish small" disabled={busy} aria-label={`Skip: ${label}`} onClick={() => mark('skipped')}>
        Skip
      </button>
      {error ? <span className="err-text small" role="alert">{error}</span> : null}
    </div>
  );
}
