'use client';

import { useActionState, useEffect } from 'react';
import { signInAction } from '@/app/actions/auth';
import { safeNext } from '@/lib/nav/safe-next';

/** `next` is the page to return to (already validated by the login page; checked again here). */
export default function LoginForm({ next = '/' }: { next?: string }) {
  const [state, action, submitting] = useActionState(signInAction, null);
  // Signed in: load the page in full. A soft navigation here races the
  // refresh Next starts when the action sets the session cookie (T18).
  useEffect(() => {
    if (state?.ok) window.location.assign(safeNext(next));
  }, [state, next]);
  const pending = submitting || !!state?.ok;
  return (
    <form action={action} className="stack" noValidate>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state?.error ? (
        <div className="callout warn" role="alert">
          {state.error}
        </div>
      ) : null}
      <button className="primary" type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
