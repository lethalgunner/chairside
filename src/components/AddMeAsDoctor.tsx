'use client';

import { useState } from 'react';
import { addMeAsDoctorAction } from '@/app/actions/settings';
import { useActionForm } from '@/lib/nav/use-action-form';
import NotSent from '@/components/NotSent';

/**
 * One press for an owner who is also a dentist (QA 9 Nov): a doctor profile on
 * their own login at every branch. Used on Settings → Doctors and wherever a
 * prescription is refused for lack of a profile.
 */
export default function AddMeAsDoctor({ label = 'Add me as a doctor', then }: { label?: string; then?: string }) {
  const { busy, notSent, send, release, navigate } = useActionForm('provider.self_add');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="actions">
      <button
        type="button"
        className="primary"
        disabled={busy}
        onClick={() =>
          void (async () => {
            setError(null);
            const res = await send(() => addMeAsDoctorAction());
            if (!res) return;
            if (!res.ok) {
              release();
              return setError(res.error);
            }
            await navigate(then);
          })()
        }
      >
        {busy ? 'Saving…' : label}
      </button>
      {error ? <div className="callout warn" role="alert">{error}</div> : null}
      <NotSent message={notSent} />
    </div>
  );
}
