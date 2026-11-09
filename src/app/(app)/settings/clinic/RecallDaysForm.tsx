'use client';

import { useState } from 'react';
import { saveRecallDaysAction } from '@/app/actions/settings';
import { useActionForm } from '@/lib/nav/use-action-form';
import NotSent from '@/components/NotSent';

/** Settings → Clinic → Come-back gaps (Sprint 8): the days that pre-fill "Come back for…" on a patient. */
export default function RecallDaysForm({ kinds, initial }: { kinds: { kind: string; label: string }[]; initial: Record<string, number> }) {
  const { busy, notSent, send, release, navigate } = useActionForm('clinic.recall_days');
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(Object.entries(initial).map(([k, d]) => [k, String(d)])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    void (async () => {
      const res = await send(() => saveRecallDaysAction(v));
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
    <form className="card" onSubmit={save} noValidate aria-label="Come-back gaps">
      <header><h2>Come-back gaps</h2></header>
      <div className="body">
        <p className="muted small">How many days ahead “Come back for…” suggests on a patient’s page. Staff can still pick any date.</p>
        <div className="field-grid">
          {kinds.map((k) => (
            <div className="field" key={k.kind}>
              <label htmlFor={`rd-${k.kind}`}>{k.label}</label>
              <div className="input-suffix">
                <input
                  id={`rd-${k.kind}`}
                  inputMode="numeric"
                  maxLength={4}
                  value={v[k.kind] ?? ''}
                  onChange={(e) => setV((x) => ({ ...x, [k.kind]: e.target.value }))}
                  aria-invalid={!!errors[k.kind]}
                  aria-describedby={errors[k.kind] ? `rd-${k.kind}-err` : undefined}
                  className={errors[k.kind] ? 'err' : undefined}
                />
                <span>days</span>
              </div>
              {errors[k.kind] ? <div className="hint err-text" id={`rd-${k.kind}-err`}>{errors[k.kind]}</div> : null}
            </div>
          ))}
        </div>
        {saved ? <div className="callout good" role="status">Come-back gaps saved.</div> : null}
        {error ? <div className="callout warn" role="alert">{error}</div> : null}
        <NotSent message={notSent} />
        <div className="actions">
          <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Update come-back gaps'}</button>
        </div>
      </div>
    </form>
  );
}
