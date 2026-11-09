'use client';

import { useState } from 'react';
import { saveDiscountCapsAction } from '@/app/actions/settings';
import { useActionForm } from '@/lib/nav/use-action-form';
import NotSent from '@/components/NotSent';

/** Settings → Clinic → Discount limits (Sprint 8). Blank = no limit, which is where every clinic starts. */
export default function DiscountCapsForm({ roles, initial }: { roles: { role: string; label: string }[]; initial: Record<string, string> }) {
  const { busy, notSent, send, release, navigate } = useActionForm('clinic.discount_caps');
  const [v, setV] = useState<Record<string, string>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    void (async () => {
      const res = await send(() => saveDiscountCapsAction(v));
      if (!res) return;
      release();
      if (!res.ok) return setError(res.error);
      if (!res.data.ok) return setErrors(res.data.fieldErrors);
      setErrors({});
      setSaved(true);
      await navigate();
    })();
  }

  return (
    <form className="card" onSubmit={save} noValidate aria-label="Discount limits">
      <header><h2>Discount limits</h2></header>
      <div className="body">
        <p className="muted small">The most each role can take off one line of a bill, as a percent. Leave blank for no limit. You, as owner, are never limited. Someone with two roles gets the higher limit.</p>
        <div className="field-grid">
          {roles.map((r) => (
            <div className="field" key={r.role}>
              <label htmlFor={`cap-${r.role}`}>{r.label}</label>
              <div className="input-suffix">
                <input
                  id={`cap-${r.role}`}
                  inputMode="numeric"
                  value={v[r.role] ?? ''}
                  placeholder="No limit"
                  maxLength={4}
                  onChange={(e) => setV((x) => ({ ...x, [r.role]: e.target.value }))}
                  aria-invalid={!!errors[r.role]}
                  aria-describedby={errors[r.role] ? `cap-${r.role}-err` : undefined}
                  className={errors[r.role] ? 'err' : undefined}
                />
                <span aria-hidden="true">%</span>
              </div>
              {errors[r.role] ? <div className="hint err-text" id={`cap-${r.role}-err`}>{errors[r.role]}</div> : null}
            </div>
          ))}
        </div>
        {saved ? <div className="callout good" role="status">Discount limits saved. They apply to the next bill.</div> : null}
        {error ? <div className="callout warn" role="alert">{error}</div> : null}
        <NotSent message={notSent} />
        <div className="actions">
          <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Update discount limits'}</button>
        </div>
      </div>
    </form>
  );
}
