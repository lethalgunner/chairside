'use client';

import { useState } from 'react';

/**
 * The invite link, shown once. It is built here from the address the owner is
 * using, so it always points at this deployment; the server never sees or
 * logs the finished link.
 */
export default function InviteLink({ token, name, reset = false, onDone }: { token: string; name: string; reset?: boolean; onDone: () => void }) {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const link = `${origin}/setup?token=${token}`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="callout good invite-link" role="status">
      <p>
        {reset ? (
          <>
            <strong>Password reset link for {name}.</strong> Send it to them privately (WhatsApp or in person). It works once, for 72 hours, and signs them out everywhere when used. Their old password works until then. It won’t be shown again.
          </>
        ) : (
          <>
            <strong>Invite link for {name}.</strong> Send it to them privately (WhatsApp or in person). It works once, for 72 hours. It won’t be shown again; if it is lost, use “New link”.
          </>
        )}
      </p>
      <div className="inline-form">
        <label className="sr-only" htmlFor="invite-link">Invite link</label>
        <input id="invite-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
        <button
          type="button"
          className="secondary-btn"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            } catch {
              (document.getElementById('invite-link') as HTMLInputElement | null)?.select();
            }
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="linkish" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}
