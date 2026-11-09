'use client';

import { useActionState } from 'react';
import { forgotPasswordAction } from '@/app/actions/auth';

export default function ForgotForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, null);
  if (state?.done) {
    return (
      <div className="callout good" role="status">
        If that email has an account, a link is on its way. It works once, for 72 hours. Check spam if it hasn&apos;t arrived in a few minutes.
      </div>
    );
  }
  return (
    <form action={action} className="stack" noValidate>
      <div className="field">
        <label htmlFor="forgot-email">Email</label>
        <input id="forgot-email" name="email" type="email" autoComplete="username" required autoFocus />
      </div>
      {state?.error ? <div className="callout warn" role="alert">{state.error}</div> : null}
      <button className="primary" type="submit" disabled={pending}>{pending ? 'Sending…' : 'Email me a link'}</button>
    </form>
  );
}
