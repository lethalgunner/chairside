'use client';

import { useActionState } from 'react';
import { acceptInviteAction } from '@/app/actions/auth';

export default function SetupForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInviteAction, null);
  return (
    <form action={action} className="stack" noValidate>
      <input type="hidden" name="token" value={token} />
      <div className="field">
        <label htmlFor="password">New password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required aria-describedby="pw-hint" autoFocus />
        <div className="hint" id="pw-hint">At least 10 characters. A short sentence is easiest to remember.</div>
      </div>
      <div className="field">
        <label htmlFor="confirm">Type it again</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </div>
      {state?.error ? (
        <div className="callout warn" role="alert">{state.error}</div>
      ) : null}
      <button className="primary" type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Set password and sign in'}
      </button>
    </form>
  );
}
